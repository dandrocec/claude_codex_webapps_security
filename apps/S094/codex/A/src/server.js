const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const { getDb } = require("./db");
const { deliverEvent, retryDelivery } = require("./deliveries");
const { assertAllowedUrlSyntax, makeToken } = require("./security");

const app = express();
const port = Number(process.env.PORT || 5094);
const dataDir = path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "2mb", type: ["application/json", "application/*+json"] }));
app.use(express.text({ limit: "2mb", type: ["text/*", "application/xml", "application/x-www-form-urlencoded"] }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    store: new SQLiteStore({ dir: dataDir, db: "sessions.sqlite" }),
    secret: process.env.SESSION_SECRET || "local-development-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax" }
  })
);

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.error = null;
  res.locals.notice = null;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function parseInboundBody(req) {
  if (req.is("application/json") || req.is("application/*+json")) return req.body ?? {};
  if (typeof req.body === "string") return { raw: req.body };
  return req.body ?? {};
}

app.get("/", (req, res) => {
  if (req.session.user) return res.redirect("/dashboard");
  res.redirect("/login");
});

app.get("/register", (req, res) => res.render("auth", { mode: "register" }));

app.post("/register", async (req, res) => {
  const db = await getDb();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!email || password.length < 8) {
    return res.status(400).render("auth", { mode: "register", error: "Use an email and a password of at least 8 characters." });
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = await db.run("INSERT INTO users (email, password_hash) VALUES (?, ?)", email, hash);
    req.session.user = { id: result.lastID, email };
    res.redirect("/dashboard");
  } catch (error) {
    res.status(400).render("auth", { mode: "register", error: "That email is already registered." });
  }
});

app.get("/login", (req, res) => res.render("auth", { mode: "login" }));

app.post("/login", async (req, res) => {
  const db = await getDb();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = await db.get("SELECT * FROM users WHERE email = ?", email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).render("auth", { mode: "login", error: "Invalid email or password." });
  }
  req.session.user = { id: user.id, email: user.email };
  res.redirect("/dashboard");
});

app.post("/logout", requireAuth, (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/dashboard", requireAuth, async (req, res) => {
  const db = await getDb();
  const userId = req.session.user.id;
  const [webhooks, events, deliveries] = await Promise.all([
    db.all(
      `SELECT w.*, COUNT(a.id) AS action_count
       FROM webhooks w
       LEFT JOIN actions a ON a.webhook_id = w.id AND a.is_active = 1
       WHERE w.user_id = ?
       GROUP BY w.id
       ORDER BY w.created_at DESC`,
      userId
    ),
    db.all(
      `SELECT e.*, w.name AS webhook_name
       FROM events e
       JOIN webhooks w ON w.id = e.webhook_id
       WHERE e.user_id = ?
       ORDER BY e.created_at DESC
       LIMIT 20`,
      userId
    ),
    db.all(
      `SELECT d.*, a.name AS action_name, a.target_url, w.name AS webhook_name
       FROM deliveries d
       JOIN actions a ON a.id = d.action_id
       JOIN events e ON e.id = d.event_id
       JOIN webhooks w ON w.id = e.webhook_id
       WHERE d.user_id = ?
       ORDER BY d.created_at DESC
       LIMIT 30`,
      userId
    )
  ]);
  res.render("dashboard", {
    webhooks,
    events,
    deliveries,
    baseUrl: `${req.protocol}://${req.get("host")}`
  });
});

app.post("/webhooks", requireAuth, async (req, res) => {
  const db = await getDb();
  const name = String(req.body.name || "").trim();
  if (!name) return res.redirect("/dashboard");
  await db.run("INSERT INTO webhooks (user_id, name, token) VALUES (?, ?, ?)", req.session.user.id, name, makeToken());
  res.redirect("/dashboard");
});

app.post("/webhooks/:id/delete", requireAuth, async (req, res) => {
  const db = await getDb();
  await db.run("DELETE FROM webhooks WHERE id = ? AND user_id = ?", req.params.id, req.session.user.id);
  res.redirect("/dashboard");
});

app.get("/webhooks/:id", requireAuth, async (req, res) => {
  const db = await getDb();
  const webhook = await db.get("SELECT * FROM webhooks WHERE id = ? AND user_id = ?", req.params.id, req.session.user.id);
  if (!webhook) return res.status(404).send("Webhook not found");
  const actions = await db.all("SELECT * FROM actions WHERE webhook_id = ? AND user_id = ? ORDER BY created_at DESC", webhook.id, req.session.user.id);
  res.render("webhook", {
    webhook,
    actions,
    baseUrl: `${req.protocol}://${req.get("host")}`,
    error: req.query.error || null,
    notice: req.query.notice || null
  });
});

app.post("/webhooks/:id/actions", requireAuth, async (req, res) => {
  const db = await getDb();
  const webhook = await db.get("SELECT * FROM webhooks WHERE id = ? AND user_id = ?", req.params.id, req.session.user.id);
  if (!webhook) return res.status(404).send("Webhook not found");
  const name = String(req.body.name || "").trim();
  const rawUrl = String(req.body.target_url || "").trim();
  try {
    const targetUrl = assertAllowedUrlSyntax(rawUrl);
    await db.run(
      "INSERT INTO actions (webhook_id, user_id, name, target_url) VALUES (?, ?, ?, ?)",
      webhook.id,
      req.session.user.id,
      name || "Outbound action",
      targetUrl
    );
    res.redirect(`/webhooks/${webhook.id}?notice=Action%20created`);
  } catch (error) {
    res.redirect(`/webhooks/${webhook.id}?error=${encodeURIComponent(error.message)}`);
  }
});

app.post("/actions/:id/toggle", requireAuth, async (req, res) => {
  const db = await getDb();
  const action = await db.get("SELECT * FROM actions WHERE id = ? AND user_id = ?", req.params.id, req.session.user.id);
  if (!action) return res.status(404).send("Action not found");
  await db.run("UPDATE actions SET is_active = ? WHERE id = ? AND user_id = ?", action.is_active ? 0 : 1, action.id, req.session.user.id);
  res.redirect(`/webhooks/${action.webhook_id}`);
});

app.post("/deliveries/:id/retry", requireAuth, async (req, res) => {
  await retryDelivery(req.params.id, req.session.user.id);
  res.redirect("/dashboard");
});

app.all("/hooks/:token", async (req, res) => {
  const db = await getDb();
  const webhook = await db.get("SELECT * FROM webhooks WHERE token = ? AND is_active = 1", req.params.token);
  if (!webhook) return res.status(404).json({ error: "Webhook not found" });
  const body = parseInboundBody(req);
  const result = await db.run(
    `INSERT INTO events (webhook_id, user_id, method, headers_json, body_json, source_ip)
     VALUES (?, ?, ?, ?, ?, ?)`,
    webhook.id,
    webhook.user_id,
    req.method,
    JSON.stringify(req.headers),
    JSON.stringify(body),
    req.ip
  );
  const deliveries = await deliverEvent(result.lastID);
  res.status(202).json({
    accepted: true,
    eventId: result.lastID,
    deliveries: deliveries.filter(Boolean).map((delivery) => ({
      id: delivery.id,
      action: delivery.action_name,
      status: delivery.status,
      statusCode: delivery.status_code
    }))
  });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).send("Unexpected error");
});

getDb().then(() => {
  app.listen(port, () => {
    console.log(`Integration hub listening on http://localhost:${port}`);
  });
});
