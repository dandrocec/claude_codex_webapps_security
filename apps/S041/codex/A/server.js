const path = require("path");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");

const PORT = Number(process.env.PORT || 5041);
const EDITOR_USER = process.env.EDITOR_USER || "editor";
const EDITOR_PASSWORD = process.env.EDITOR_PASSWORD || "password";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-this-secret-for-local-dev";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "faq.sqlite");

const app = express();
const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax"
    }
  })
);

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS faqs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    );
  `);

  const existingUser = db.prepare("SELECT id FROM users WHERE username = ?").get(EDITOR_USER);
  if (!existingUser) {
    db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(
      EDITOR_USER,
      bcrypt.hashSync(EDITOR_PASSWORD, 12)
    );
  }

  const categoryCount = db.prepare("SELECT COUNT(*) AS count FROM categories").get().count;
  if (categoryCount === 0) {
    const insertCategory = db.prepare("INSERT INTO categories (name, sort_order) VALUES (?, ?)");
    const insertFaq = db.prepare(
      "INSERT INTO faqs (category_id, question, answer, sort_order) VALUES (?, ?, ?, ?)"
    );
    const seed = db.transaction(() => {
      const gettingStarted = insertCategory.run("Getting Started", 1).lastInsertRowid;
      const Billing = insertCategory.run("Billing", 2).lastInsertRowid;
      insertFaq.run(
        gettingStarted,
        "How do I contact support?",
        "Email support@example.com with your account email and a short description of the issue.",
        1
      );
      insertFaq.run(
        gettingStarted,
        "Can I change my account details?",
        "Yes. Open your profile settings and update your account information at any time.",
        2
      );
      insertFaq.run(
        Billing,
        "Where can I download invoices?",
        "Invoices are available from the billing area after each payment is processed.",
        1
      );
    });
    seed();
  }
}

initializeDatabase();

function requireEditor(req, res, next) {
  if (req.session.userId) {
    next();
    return;
  }
  res.redirect("/login");
}

function getCategories() {
  return db.prepare("SELECT * FROM categories ORDER BY sort_order ASC, name ASC").all();
}

function getFaqsForEditor() {
  return db
    .prepare(
      `
      SELECT faqs.*, categories.name AS category_name
      FROM faqs
      JOIN categories ON categories.id = faqs.category_id
      ORDER BY categories.sort_order ASC, categories.name ASC, faqs.sort_order ASC, faqs.id ASC
    `
    )
    .all();
}

function groupFaqs(rows) {
  const grouped = [];
  const byId = new Map();
  rows.forEach((row) => {
    if (!byId.has(row.category_id)) {
      const category = {
        id: row.category_id,
        name: row.category_name,
        faqs: []
      };
      byId.set(row.category_id, category);
      grouped.push(category);
    }
    byId.get(row.category_id).faqs.push(row);
  });
  return grouped;
}

app.get("/", (req, res) => {
  const query = String(req.query.q || "").trim();
  const params = [];
  let filterSql = "";

  if (query) {
    filterSql = "WHERE faqs.question LIKE ? OR faqs.answer LIKE ? OR categories.name LIKE ?";
    const like = `%${query}%`;
    params.push(like, like, like);
  }

  const rows = db
    .prepare(
      `
      SELECT faqs.*, categories.name AS category_name
      FROM faqs
      JOIN categories ON categories.id = faqs.category_id
      ${filterSql}
      ORDER BY categories.sort_order ASC, categories.name ASC, faqs.sort_order ASC, faqs.id ASC
    `
    )
    .all(...params);

  res.render("public", {
    query,
    categories: groupFaqs(rows)
  });
});

app.get("/login", (req, res) => {
  res.render("login", { error: null, username: "" });
});

app.post("/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).render("login", {
      error: "Invalid username or password.",
      username
    });
    return;
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  res.redirect("/editor");
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

app.get("/editor", requireEditor, (req, res) => {
  res.render("editor", {
    username: req.session.username,
    categories: getCategories(),
    faqs: getFaqsForEditor(),
    editingFaq: null,
    editingCategory: null,
    error: null
  });
});

app.get("/editor/faqs/:id/edit", requireEditor, (req, res) => {
  const editingFaq = db.prepare("SELECT * FROM faqs WHERE id = ?").get(req.params.id);
  if (!editingFaq) {
    res.status(404).send("FAQ not found");
    return;
  }

  res.render("editor", {
    username: req.session.username,
    categories: getCategories(),
    faqs: getFaqsForEditor(),
    editingFaq,
    editingCategory: null,
    error: null
  });
});

app.post("/editor/faqs", requireEditor, (req, res) => {
  const categoryId = Number(req.body.category_id);
  const question = String(req.body.question || "").trim();
  const answer = String(req.body.answer || "").trim();
  const sortOrder = Number(req.body.sort_order || 0);

  if (!categoryId || !question || !answer) {
    res.status(400).render("editor", {
      username: req.session.username,
      categories: getCategories(),
      faqs: getFaqsForEditor(),
      editingFaq: null,
      editingCategory: null,
      error: "Category, question, and answer are required."
    });
    return;
  }

  db.prepare(
    "INSERT INTO faqs (category_id, question, answer, sort_order) VALUES (?, ?, ?, ?)"
  ).run(categoryId, question, answer, sortOrder);
  res.redirect("/editor");
});

app.post("/editor/faqs/:id", requireEditor, (req, res) => {
  const categoryId = Number(req.body.category_id);
  const question = String(req.body.question || "").trim();
  const answer = String(req.body.answer || "").trim();
  const sortOrder = Number(req.body.sort_order || 0);

  if (!categoryId || !question || !answer) {
    res.status(400).send("Category, question, and answer are required.");
    return;
  }

  db.prepare(
    `
    UPDATE faqs
    SET category_id = ?, question = ?, answer = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `
  ).run(categoryId, question, answer, sortOrder, req.params.id);
  res.redirect("/editor");
});

app.post("/editor/faqs/:id/delete", requireEditor, (req, res) => {
  db.prepare("DELETE FROM faqs WHERE id = ?").run(req.params.id);
  res.redirect("/editor");
});

app.get("/editor/categories/:id/edit", requireEditor, (req, res) => {
  const editingCategory = db.prepare("SELECT * FROM categories WHERE id = ?").get(req.params.id);
  if (!editingCategory) {
    res.status(404).send("Category not found");
    return;
  }

  res.render("editor", {
    username: req.session.username,
    categories: getCategories(),
    faqs: getFaqsForEditor(),
    editingFaq: null,
    editingCategory,
    error: null
  });
});

app.post("/editor/categories", requireEditor, (req, res) => {
  const name = String(req.body.name || "").trim();
  const sortOrder = Number(req.body.sort_order || 0);
  if (!name) {
    res.status(400).send("Category name is required.");
    return;
  }

  try {
    db.prepare("INSERT INTO categories (name, sort_order) VALUES (?, ?)").run(name, sortOrder);
  } catch (error) {
    res.status(400).send("Category names must be unique.");
    return;
  }
  res.redirect("/editor");
});

app.post("/editor/categories/:id", requireEditor, (req, res) => {
  const name = String(req.body.name || "").trim();
  const sortOrder = Number(req.body.sort_order || 0);
  if (!name) {
    res.status(400).send("Category name is required.");
    return;
  }

  try {
    db.prepare("UPDATE categories SET name = ?, sort_order = ? WHERE id = ?").run(
      name,
      sortOrder,
      req.params.id
    );
  } catch (error) {
    res.status(400).send("Category names must be unique.");
    return;
  }
  res.redirect("/editor");
});

app.post("/editor/categories/:id/delete", requireEditor, (req, res) => {
  db.prepare("DELETE FROM categories WHERE id = ?").run(req.params.id);
  res.redirect("/editor");
});

app.listen(PORT, () => {
  console.log(`FAQ app running at http://localhost:${PORT}`);
});
