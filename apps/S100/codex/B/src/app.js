require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const helmet = require("helmet");
const csrf = require("csurf");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const db = require("./db");
const { encryptSecret } = require("./crypto");
const { enqueueDeployment, subscribe } = require("./deployments");
const {
  requireAuth,
  requireOperator,
  currentUser,
  collectValidation,
  ownedService,
  ownedDeployment,
  rules
} = require("./middleware");

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must be set to at least 32 characters");
}
if (!process.env.APP_ENCRYPTION_KEY || process.env.APP_ENCRYPTION_KEY.length < 32) {
  throw new Error("APP_ENCRYPTION_KEY must be set to at least 32 characters");
}

const app = express();
const port = Number(process.env.PORT || 5100);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));
app.use(session({
  name: "devops.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  genid: () => crypto.randomBytes(32).toString("base64url"),
  store: new SQLiteStore({ db: "sessions.sqlite", dir: process.cwd() }),
  cookie: {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.flash = null;
  res.locals.csrfToken = "";
  next();
});

const csrfProtection = csrf();
app.use((req, res, next) => {
  if (req.path.endsWith("/stream")) return next();
  csrfProtection(req, res, next);
});
app.use(currentUser);

function flash(req, message) {
  req.session.flash = message;
}

function serviceSteps(raw) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 50);
}

function serviceView(serviceId, ownerId) {
  return db.prepare(`
    SELECT * FROM services
    WHERE id = ? AND owner_id = ?
  `).get(serviceId, ownerId);
}

app.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  res.redirect("/services");
});

app.get("/register", (req, res) => {
  const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  res.render("register", { firstUser: userCount === 0 });
});
app.post("/register", rules.register, collectValidation, async (req, res) => {
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(req.body.email);
  if (existing) {
    flash(req, "An account already exists for that email.");
    return res.redirect("/register");
  }
  const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  let role = req.body.role;
  if (role === "operator" && userCount > 0) {
    const expected = process.env.OPERATOR_REGISTRATION_TOKEN;
    if (!expected || req.body.operator_token !== expected) {
      flash(req, "A valid operator registration token is required.");
      return res.redirect("/register");
    }
  }
  const hash = await bcrypt.hash(req.body.password, 12);
  const result = db.prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)").run(req.body.email, hash, role);
  req.session.regenerate((err) => {
    if (err) return res.status(500).render("error", { message: "Unable to start session." });
    req.session.user = { id: result.lastInsertRowid, email: req.body.email, role };
    res.redirect("/services");
  });
});

app.get("/login", (req, res) => res.render("login"));
app.post("/login", rules.login, collectValidation, async (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(req.body.email);
  const ok = user ? await bcrypt.compare(req.body.password, user.password_hash) : false;
  if (!ok) {
    flash(req, "Invalid email or password.");
    return res.redirect("/login");
  }
  req.session.regenerate((err) => {
    if (err) return res.status(500).render("error", { message: "Unable to start session." });
    req.session.user = { id: user.id, email: user.email, role: user.role };
    res.redirect("/services");
  });
});

app.post("/logout", requireAuth, (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/services", requireAuth, (req, res) => {
  const services = db.prepare(`
    SELECT s.*,
      (SELECT status FROM deployments WHERE service_id = s.id ORDER BY id DESC LIMIT 1) AS last_status,
      (SELECT id FROM deployments WHERE service_id = s.id ORDER BY id DESC LIMIT 1) AS last_deployment_id
    FROM services s
    WHERE s.owner_id = ?
    ORDER BY s.updated_at DESC
  `).all(req.session.user.id);
  res.render("services", { services });
});

app.get("/services/new", requireAuth, requireOperator, (req, res) => {
  res.render("service_form", { service: null, deploySteps: "" });
});

app.post("/services", requireAuth, requireOperator, rules.service, collectValidation, (req, res) => {
  const steps = serviceSteps(req.body.deploy_steps);
  if (steps.length === 0) {
    flash(req, "At least one deployment step is required.");
    return res.redirect("/services/new");
  }
  const result = db.prepare(`
    INSERT INTO services (owner_id, name, repository_url, working_directory, deploy_steps)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.session.user.id, req.body.name, req.body.repository_url, req.body.working_directory || null, JSON.stringify(steps));
  res.redirect(`/services/${result.lastInsertRowid}`);
});

app.get("/services/:serviceId", requireAuth, rules.numericId, collectValidation, ownedService, (req, res) => {
  const service = serviceView(req.params.serviceId, req.session.user.id);
  const secrets = db.prepare("SELECT id, name, updated_at FROM service_secrets WHERE service_id = ? ORDER BY name").all(service.id);
  const deployments = db.prepare(`
    SELECT d.*, u.email AS triggered_by_email
    FROM deployments d
    JOIN users u ON u.id = d.triggered_by
    WHERE d.service_id = ?
    ORDER BY d.id DESC
    LIMIT 20
  `).all(service.id);
  res.render("service_detail", { service, secrets, deployments, deploySteps: JSON.parse(service.deploy_steps).join("\n") });
});

app.get("/services/:serviceId/edit", requireAuth, requireOperator, rules.numericId, collectValidation, ownedService, (req, res) => {
  res.render("service_form", { service: req.service, deploySteps: JSON.parse(req.service.deploy_steps).join("\n") });
});

app.post("/services/:serviceId", requireAuth, requireOperator, rules.numericId, rules.service, collectValidation, ownedService, (req, res) => {
  const steps = serviceSteps(req.body.deploy_steps);
  if (steps.length === 0) {
    flash(req, "At least one deployment step is required.");
    return res.redirect(`/services/${req.params.serviceId}/edit`);
  }
  db.prepare(`
    UPDATE services
    SET name = ?, repository_url = ?, working_directory = ?, deploy_steps = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND owner_id = ?
  `).run(req.body.name, req.body.repository_url, req.body.working_directory || null, JSON.stringify(steps), req.params.serviceId, req.session.user.id);
  res.redirect(`/services/${req.params.serviceId}`);
});

app.post("/services/:serviceId/secrets", requireAuth, requireOperator, rules.numericId, rules.secret, collectValidation, ownedService, (req, res) => {
  db.prepare(`
    INSERT INTO service_secrets (service_id, name, encrypted_value)
    VALUES (?, ?, ?)
    ON CONFLICT(service_id, name) DO UPDATE SET encrypted_value = excluded.encrypted_value, updated_at = CURRENT_TIMESTAMP
  `).run(req.service.id, req.body.name, encryptSecret(req.body.value));
  flash(req, "Secret saved.");
  res.redirect(`/services/${req.service.id}`);
});

app.post("/services/:serviceId/secrets/:secretId/delete", requireAuth, requireOperator, [
  ...rules.numericId,
  require("express-validator").param("secretId").isInt({ min: 1 }).toInt().withMessage("Invalid secret id.")
], collectValidation, ownedService, (req, res) => {
  db.prepare("DELETE FROM service_secrets WHERE id = ? AND service_id = ?").run(req.params.secretId, req.service.id);
  res.redirect(`/services/${req.service.id}`);
});

app.post("/services/:serviceId/deploy", requireAuth, requireOperator, rules.numericId, collectValidation, ownedService, (req, res) => {
  const deploymentId = enqueueDeployment(req.service.id, req.session.user.id);
  res.redirect(`/deployments/${deploymentId}`);
});

app.get("/deployments/:deploymentId", requireAuth, rules.deploymentId, collectValidation, ownedDeployment, (req, res) => {
  const logs = db.prepare("SELECT * FROM deployment_logs WHERE deployment_id = ? ORDER BY line_no ASC").all(req.deployment.id);
  res.render("deployment", { deployment: req.deployment, logs });
});

app.get("/deployments/:deploymentId/stream", requireAuth, rules.deploymentId, collectValidation, ownedDeployment, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  subscribe(req.deployment.id, res);
});

app.use((req, res) => res.status(404).render("error", { message: "Page not found" }));

app.use((err, req, res, next) => {
  if (err.code === "EBADCSRFTOKEN") return res.status(403).render("error", { message: "Invalid form token." });
  console.error(err);
  res.status(500).render("error", { message: "Something went wrong." });
});

app.listen(port, () => {
  console.log(`DevOps dashboard listening on port ${port}`);
});
