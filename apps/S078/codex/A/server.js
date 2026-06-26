const express = require("express");
const session = require("express-session");
const methodOverride = require("method-override");
const bcrypt = require("bcryptjs");
const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 5078);
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "crm.sqlite");
const STAGES = ["Prospecting", "Qualified", "Proposal", "Negotiation", "Closed Won", "Closed Lost"];

let db;
let SQL;

function persist() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function run(sql, params = []) {
  db.run(sql, params);
  persist();
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function get(sql, params = []) {
  return all(sql, params)[0] || null;
}

function scalar(sql, params = []) {
  const row = get(sql, params);
  if (!row) return null;
  return row[Object.keys(row)[0]];
}

async function initDatabase() {
  SQL = await initSqlJs({
    locateFile: (file) => path.join(__dirname, "node_modules", "sql.js", "dist", file)
  });

  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('sales', 'manager'))
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id),
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      company TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id),
      contact_id INTEGER REFERENCES contacts(id),
      title TEXT NOT NULL,
      value INTEGER NOT NULL DEFAULT 0,
      stage TEXT NOT NULL,
      close_date TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const userCount = scalar("SELECT COUNT(*) AS count FROM users");
  if (!userCount) {
    const passwordHash = bcrypt.hashSync("password123", 10);
    db.run(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)",
      [
        "Maya Manager", "manager@example.com", passwordHash, "manager",
        "Sam Seller", "sam@example.com", passwordHash, "sales",
        "Riley Rep", "riley@example.com", passwordHash, "sales"
      ]
    );
    db.run(
      `INSERT INTO contacts (owner_id, first_name, last_name, company, email, phone, notes) VALUES
       (2, 'Avery', 'Stone', 'Northstar Logistics', 'avery@northstar.example', '555-0101', 'Interested in annual contract.'),
       (2, 'Jordan', 'Lee', 'Brightline Labs', 'jordan@brightline.example', '555-0102', 'Asked for proposal this quarter.'),
       (3, 'Casey', 'Morgan', 'Harbor Foods', 'casey@harbor.example', '555-0103', 'Needs multi-location rollout.'),
       (3, 'Taylor', 'Quinn', 'Urban Grid', 'taylor@urbangrid.example', '555-0104', 'Price-sensitive, high fit.')`
    );
    db.run(
      `INSERT INTO deals (owner_id, contact_id, title, value, stage, close_date, notes) VALUES
       (2, 1, 'Northstar fleet CRM rollout', 42000, 'Qualified', '2026-07-30', 'Security review complete.'),
       (2, 2, 'Brightline team expansion', 18000, 'Proposal', '2026-08-15', 'Proposal sent to buyer.'),
       (3, 3, 'Harbor enterprise pilot', 65000, 'Negotiation', '2026-09-01', 'Legal reviewing MSA.'),
       (3, 4, 'Urban Grid starter plan', 9000, 'Prospecting', '2026-07-12', 'Discovery call scheduled.')`
    );
    persist();
  } else {
    persist();
  }
}

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride("_method"));
app.use(session({
  secret: process.env.SESSION_SECRET || "local-crm-session-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax" }
}));

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.stages = STAGES;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function visibleOwnerFilter(user, alias = "") {
  return user.role === "manager" ? { sql: "", params: [] } : { sql: ` AND ${alias}owner_id = ?`, params: [user.id] };
}

function ownedUsers(user) {
  if (user.role === "manager") return all("SELECT id, name, role FROM users ORDER BY role, name");
  return all("SELECT id, name, role FROM users WHERE id = ?", [user.id]);
}

function ensureAssignableOwner(req, res, next) {
  if (req.session.user.role === "manager") return next();
  if (Number(req.body.owner_id || req.session.user.id) !== req.session.user.id) {
    req.session.flash = "Sales users can only assign records to themselves.";
    return res.redirect("back");
  }
  next();
}

app.get("/", (req, res) => {
  res.redirect(req.session.user ? "/board" : "/login");
});

app.get("/login", (req, res) => {
  res.render("login", { title: "Sign in" });
});

app.post("/login", (req, res) => {
  const user = get("SELECT * FROM users WHERE email = ?", [String(req.body.email || "").trim().toLowerCase()]);
  if (!user || !bcrypt.compareSync(req.body.password || "", user.password_hash)) {
    return res.status(401).render("login", { title: "Sign in", error: "Invalid email or password." });
  }
  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  res.redirect("/board");
});

app.post("/logout", requireAuth, (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/board", requireAuth, (req, res) => {
  const filter = visibleOwnerFilter(req.session.user, "d.");
  const deals = all(
    `SELECT d.*, u.name AS owner_name, c.first_name || ' ' || c.last_name AS contact_name, c.company
     FROM deals d
     JOIN users u ON u.id = d.owner_id
     LEFT JOIN contacts c ON c.id = d.contact_id
     WHERE 1=1 ${filter.sql}
     ORDER BY d.value DESC, d.updated_at DESC`,
    filter.params
  );
  const totals = {};
  STAGES.forEach((stage) => {
    totals[stage] = deals.filter((deal) => deal.stage === stage).reduce((sum, deal) => sum + Number(deal.value || 0), 0);
  });
  res.render("board", { title: "Pipeline", deals, totals });
});

app.post("/deals/:id/stage", requireAuth, (req, res) => {
  const deal = get("SELECT * FROM deals WHERE id = ?", [req.params.id]);
  if (!deal || (req.session.user.role !== "manager" && deal.owner_id !== req.session.user.id)) return res.sendStatus(404);
  if (!STAGES.includes(req.body.stage)) return res.status(400).send("Invalid stage");
  run("UPDATE deals SET stage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [req.body.stage, req.params.id]);
  res.redirect("/board");
});

app.get("/contacts", requireAuth, (req, res) => {
  const q = String(req.query.q || "").trim();
  const filter = visibleOwnerFilter(req.session.user, "c.");
  const searchSql = q ? " AND (c.first_name LIKE ? OR c.last_name LIKE ? OR c.company LIKE ? OR c.email LIKE ?)" : "";
  const searchParams = q ? [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`] : [];
  const contacts = all(
    `SELECT c.*, u.name AS owner_name
     FROM contacts c JOIN users u ON u.id = c.owner_id
     WHERE 1=1 ${filter.sql} ${searchSql}
     ORDER BY c.company, c.last_name`,
    [...filter.params, ...searchParams]
  );
  res.render("contacts", { title: "Contacts", contacts, q, users: ownedUsers(req.session.user) });
});

app.post("/contacts", requireAuth, ensureAssignableOwner, (req, res) => {
  const ownerId = req.session.user.role === "manager" ? Number(req.body.owner_id) : req.session.user.id;
  run(
    "INSERT INTO contacts (owner_id, first_name, last_name, company, email, phone, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [ownerId, req.body.first_name, req.body.last_name, req.body.company, req.body.email, req.body.phone, req.body.notes]
  );
  res.redirect("/contacts");
});

app.post("/contacts/:id", requireAuth, ensureAssignableOwner, (req, res) => {
  const contact = get("SELECT * FROM contacts WHERE id = ?", [req.params.id]);
  if (!contact || (req.session.user.role !== "manager" && contact.owner_id !== req.session.user.id)) return res.sendStatus(404);
  const ownerId = req.session.user.role === "manager" ? Number(req.body.owner_id) : req.session.user.id;
  run(
    "UPDATE contacts SET owner_id = ?, first_name = ?, last_name = ?, company = ?, email = ?, phone = ?, notes = ? WHERE id = ?",
    [ownerId, req.body.first_name, req.body.last_name, req.body.company, req.body.email, req.body.phone, req.body.notes, req.params.id]
  );
  res.redirect("/contacts");
});

app.delete("/contacts/:id", requireAuth, (req, res) => {
  const contact = get("SELECT * FROM contacts WHERE id = ?", [req.params.id]);
  if (!contact || (req.session.user.role !== "manager" && contact.owner_id !== req.session.user.id)) return res.sendStatus(404);
  run("UPDATE deals SET contact_id = NULL WHERE contact_id = ?", [req.params.id]);
  run("DELETE FROM contacts WHERE id = ?", [req.params.id]);
  res.redirect("/contacts");
});

app.get("/deals", requireAuth, (req, res) => {
  const filter = visibleOwnerFilter(req.session.user, "d.");
  const deals = all(
    `SELECT d.*, u.name AS owner_name, c.first_name || ' ' || c.last_name AS contact_name, c.company
     FROM deals d
     JOIN users u ON u.id = d.owner_id
     LEFT JOIN contacts c ON c.id = d.contact_id
     WHERE 1=1 ${filter.sql}
     ORDER BY d.updated_at DESC`,
    filter.params
  );
  const contactFilter = visibleOwnerFilter(req.session.user);
  const contacts = all("SELECT id, first_name || ' ' || last_name || ' - ' || company AS label FROM contacts WHERE 1=1 " + contactFilter.sql + " ORDER BY company", contactFilter.params);
  res.render("deals", { title: "Deals", deals, contacts, users: ownedUsers(req.session.user) });
});

app.post("/deals", requireAuth, ensureAssignableOwner, (req, res) => {
  const ownerId = req.session.user.role === "manager" ? Number(req.body.owner_id) : req.session.user.id;
  run(
    "INSERT INTO deals (owner_id, contact_id, title, value, stage, close_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [ownerId, req.body.contact_id || null, req.body.title, Number(req.body.value || 0), req.body.stage, req.body.close_date, req.body.notes]
  );
  res.redirect("/deals");
});

app.post("/deals/:id", requireAuth, ensureAssignableOwner, (req, res) => {
  const deal = get("SELECT * FROM deals WHERE id = ?", [req.params.id]);
  if (!deal || (req.session.user.role !== "manager" && deal.owner_id !== req.session.user.id)) return res.sendStatus(404);
  const ownerId = req.session.user.role === "manager" ? Number(req.body.owner_id) : req.session.user.id;
  run(
    `UPDATE deals
     SET owner_id = ?, contact_id = ?, title = ?, value = ?, stage = ?, close_date = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [ownerId, req.body.contact_id || null, req.body.title, Number(req.body.value || 0), req.body.stage, req.body.close_date, req.body.notes, req.params.id]
  );
  res.redirect("/deals");
});

app.delete("/deals/:id", requireAuth, (req, res) => {
  const deal = get("SELECT * FROM deals WHERE id = ?", [req.params.id]);
  if (!deal || (req.session.user.role !== "manager" && deal.owner_id !== req.session.user.id)) return res.sendStatus(404);
  run("DELETE FROM deals WHERE id = ?", [req.params.id]);
  res.redirect("/deals");
});

app.use((req, res) => {
  res.status(404).render("not-found", { title: "Not found" });
});

initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`CRM running on http://localhost:${PORT}`);
  });
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
