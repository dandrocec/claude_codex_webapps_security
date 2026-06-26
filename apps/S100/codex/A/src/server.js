const path = require("path");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const bcrypt = require("bcryptjs");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const { spawn } = require("child_process");

const PORT = Number(process.env.PORT || 5100);
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "devops.sqlite");
const SQLiteStore = SQLiteStoreFactory(session);

fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
let db;
const liveStreams = new Map();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    store: new SQLiteStore({ db: "sessions.sqlite", dir: DATA_DIR }),
    secret: process.env.SESSION_SECRET || "devops-dashboard-local-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax" }
  })
);
app.use("/public", express.static(path.join(ROOT, "public")));

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function requireOperator(req, res, next) {
  if (req.session.user?.role !== "operator") {
    return res.status(403).send(page(req, "Forbidden", "<main><h1>Forbidden</h1><p>Operator access is required.</p></main>"));
  }
  next();
}

async function initDb() {
  db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('viewer', 'operator')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      repository TEXT NOT NULL DEFAULT '',
      working_dir TEXT NOT NULL DEFAULT '',
      deployment_steps TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS service_secrets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(service_id, name)
    );
    CREATE TABLE IF NOT EXISTS deployments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      triggered_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed')),
      started_at TEXT,
      finished_at TEXT,
      exit_code INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS deployment_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deployment_id INTEGER NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
      stream TEXT NOT NULL CHECK(stream IN ('system', 'stdout', 'stderr')),
      line TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const userCount = await db.get("SELECT COUNT(*) AS count FROM users");
  if (userCount.count === 0) {
    await db.run(
      "INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?), (?, ?, ?)",
      "operator@example.com",
      bcrypt.hashSync("operator123", 10),
      "operator",
      "viewer@example.com",
      bcrypt.hashSync("viewer123", 10),
      "viewer"
    );
  }
}

function page(req, title, body) {
  const user = req.session.user;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · DevOps Dashboard</title>
  <link rel="stylesheet" href="/public/styles.css">
</head>
<body>
  <header class="topbar">
    <a class="brand" href="/">DevOps Dashboard</a>
    ${user ? `<nav><span>${escapeHtml(user.email)} · ${escapeHtml(user.role)}</span><form method="post" action="/logout"><button>Sign out</button></form></nav>` : ""}
  </header>
  ${body}
</body>
</html>`;
}

function loginPage(req, error = "") {
  return page(
    req,
    "Sign in",
    `<main class="auth">
      <section class="panel login-panel">
        <h1>Sign in</h1>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
        <form method="post" action="/login" class="stack">
          <label>Email<input name="email" type="email" required autofocus></label>
          <label>Password<input name="password" type="password" required></label>
          <button class="primary">Sign in</button>
        </form>
      </section>
    </main>`
  );
}

async function dashboardPage(req) {
  const services = await db.all(`
    SELECT s.*,
      (SELECT status FROM deployments d WHERE d.service_id = s.id ORDER BY d.created_at DESC LIMIT 1) AS last_status,
      (SELECT created_at FROM deployments d WHERE d.service_id = s.id ORDER BY d.created_at DESC LIMIT 1) AS last_deploy
    FROM services s ORDER BY s.name
  `);
  const deployments = await db.all(`
    SELECT d.*, s.name AS service_name, u.email AS user_email
    FROM deployments d
    JOIN services s ON s.id = d.service_id
    LEFT JOIN users u ON u.id = d.triggered_by
    ORDER BY d.created_at DESC LIMIT 20
  `);
  const isOperator = req.session.user.role === "operator";

  return page(
    req,
    "Services",
    `<main class="layout">
      <section>
        <div class="section-heading">
          <h1>Services</h1>
          ${isOperator ? `<a class="button primary" href="/services/new">Register service</a>` : ""}
        </div>
        <div class="service-grid">
          ${services.length ? services.map(serviceCard).join("") : `<p class="empty">No services registered.</p>`}
        </div>
      </section>
      <aside class="panel">
        <h2>Recent deployments</h2>
        <div class="timeline">
          ${deployments.length ? deployments.map(deploymentRow).join("") : `<p class="empty">No deployments yet.</p>`}
        </div>
      </aside>
    </main>`
  );
}

function serviceCard(service) {
  return `<article class="panel service-card">
    <div>
      <h2><a href="/services/${service.id}">${escapeHtml(service.name)}</a></h2>
      <p>${escapeHtml(service.description || "No description")}</p>
    </div>
    <dl>
      <dt>Repository</dt><dd>${escapeHtml(service.repository || "Not set")}</dd>
      <dt>Last status</dt><dd><span class="status ${escapeHtml(service.last_status || "queued")}">${escapeHtml(service.last_status || "none")}</span></dd>
      <dt>Last deploy</dt><dd>${escapeHtml(service.last_deploy || "Never")}</dd>
    </dl>
  </article>`;
}

function deploymentRow(deployment) {
  return `<a class="deployment-row" href="/deployments/${deployment.id}">
    <strong>${escapeHtml(deployment.service_name)}</strong>
    <span class="status ${escapeHtml(deployment.status)}">${escapeHtml(deployment.status)}</span>
    <small>${escapeHtml(deployment.created_at)}${deployment.user_email ? ` by ${escapeHtml(deployment.user_email)}` : ""}</small>
  </a>`;
}

function serviceForm(req, service = {}) {
  const isEdit = Boolean(service.id);
  return page(
    req,
    isEdit ? `Edit ${service.name}` : "Register Service",
    `<main class="narrow">
      <section class="panel">
        <h1>${isEdit ? "Edit service" : "Register service"}</h1>
        <form method="post" action="${isEdit ? `/services/${service.id}` : "/services"}" class="stack">
          <label>Name<input name="name" required value="${escapeHtml(service.name || "")}"></label>
          <label>Description<textarea name="description" rows="3">${escapeHtml(service.description || "")}</textarea></label>
          <label>Repository URL<input name="repository" value="${escapeHtml(service.repository || "")}"></label>
          <label>Working directory<input name="working_dir" placeholder="Optional absolute path" value="${escapeHtml(service.working_dir || "")}"></label>
          <label>Deployment shell steps<textarea name="deployment_steps" rows="9" placeholder="npm install&#10;npm test&#10;npm run deploy">${escapeHtml(service.deployment_steps || "")}</textarea></label>
          <div class="actions">
            <button class="primary">${isEdit ? "Save changes" : "Create service"}</button>
            <a class="button" href="${isEdit ? `/services/${service.id}` : "/"}">Cancel</a>
          </div>
        </form>
      </section>
    </main>`
  );
}

async function servicePage(req, id) {
  const service = await db.get("SELECT * FROM services WHERE id = ?", id);
  if (!service) return page(req, "Not found", "<main><h1>Service not found</h1></main>");
  const secrets = await db.all("SELECT id, name, updated_at FROM service_secrets WHERE service_id = ? ORDER BY name", id);
  const deployments = await db.all("SELECT * FROM deployments WHERE service_id = ? ORDER BY created_at DESC LIMIT 30", id);
  const isOperator = req.session.user.role === "operator";

  return page(
    req,
    service.name,
    `<main class="layout service-detail">
      <section class="panel">
        <div class="section-heading">
          <div>
            <h1>${escapeHtml(service.name)}</h1>
            <p>${escapeHtml(service.description || "No description")}</p>
          </div>
          <div class="actions">
            ${isOperator ? `<a class="button" href="/services/${service.id}/edit">Edit</a><form method="post" action="/services/${service.id}/deploy"><button class="primary">Deploy</button></form>` : ""}
          </div>
        </div>
        <dl class="details">
          <dt>Repository</dt><dd>${escapeHtml(service.repository || "Not set")}</dd>
          <dt>Working directory</dt><dd>${escapeHtml(service.working_dir || "Dashboard directory")}</dd>
          <dt>Deployment steps</dt><dd><pre>${escapeHtml(service.deployment_steps || "No steps configured")}</pre></dd>
        </dl>
      </section>
      <aside class="panel">
        <h2>Environment secrets</h2>
        ${isOperator ? `<form method="post" action="/services/${service.id}/secrets" class="secret-form">
          <input name="name" placeholder="NAME" pattern="[A-Za-z_][A-Za-z0-9_]*" required>
          <input name="value" placeholder="Value" type="password" required>
          <button>Add or update</button>
        </form>` : ""}
        <div class="secret-list">
          ${secrets.length ? secrets.map(secret => `<div><strong>${escapeHtml(secret.name)}</strong><span>••••••••</span><small>${escapeHtml(secret.updated_at)}</small>${isOperator ? `<form method="post" action="/services/${service.id}/secrets/${secret.id}/delete"><button>Delete</button></form>` : ""}</div>`).join("") : `<p class="empty">No secrets configured.</p>`}
        </div>
      </aside>
      <section class="panel full">
        <h2>Deployment history</h2>
        <div class="timeline">
          ${deployments.length ? deployments.map(d => `<a class="deployment-row" href="/deployments/${d.id}"><strong>#${d.id}</strong><span class="status ${escapeHtml(d.status)}">${escapeHtml(d.status)}</span><small>${escapeHtml(d.created_at)}${d.exit_code !== null ? ` · exit ${d.exit_code}` : ""}</small></a>`).join("") : `<p class="empty">No deployments yet.</p>`}
        </div>
      </section>
    </main>`
  );
}

async function deploymentPage(req, id) {
  const deployment = await db.get(`
    SELECT d.*, s.name AS service_name
    FROM deployments d JOIN services s ON s.id = d.service_id
    WHERE d.id = ?
  `, id);
  if (!deployment) return page(req, "Not found", "<main><h1>Deployment not found</h1></main>");
  const logs = await db.all("SELECT * FROM deployment_logs WHERE deployment_id = ? ORDER BY id", id);
  return page(
    req,
    `Deployment #${id}`,
    `<main class="narrow">
      <section class="panel">
        <div class="section-heading">
          <div>
            <h1>${escapeHtml(deployment.service_name)} deployment #${deployment.id}</h1>
            <p><span id="status" class="status ${escapeHtml(deployment.status)}">${escapeHtml(deployment.status)}</span></p>
          </div>
          <a class="button" href="/services/${deployment.service_id}">Back to service</a>
        </div>
        <pre id="log" class="log">${logs.map(l => `[${l.created_at}] ${l.stream}: ${l.line}`).map(escapeHtml).join("\n")}</pre>
      </section>
    </main>
    <script>
      window.DEPLOYMENT_ID = ${Number(id)};
      window.DEPLOYMENT_STATUS = ${JSON.stringify(deployment.status)};
    </script>
    <script src="/public/deployment.js"></script>`
  );
}

async function appendLog(deploymentId, stream, line) {
  await db.run("INSERT INTO deployment_logs (deployment_id, stream, line) VALUES (?, ?, ?)", deploymentId, stream, line);
  const payload = JSON.stringify({ stream, line, created_at: new Date().toISOString() });
  const clients = liveStreams.get(Number(deploymentId));
  if (clients) {
    for (const client of clients) client.write(`event: log\ndata: ${payload}\n\n`);
  }
}

async function finishDeployment(deploymentId, status, exitCode) {
  await db.run(
    "UPDATE deployments SET status = ?, finished_at = CURRENT_TIMESTAMP, exit_code = ? WHERE id = ?",
    status,
    exitCode,
    deploymentId
  );
  const clients = liveStreams.get(Number(deploymentId));
  if (clients) {
    const payload = JSON.stringify({ status, exit_code: exitCode });
    for (const client of clients) client.write(`event: done\ndata: ${payload}\n\n`);
  }
}

async function runDeployment(deploymentId, service) {
  await db.run("UPDATE deployments SET status = 'running', started_at = CURRENT_TIMESTAMP WHERE id = ?", deploymentId);
  await appendLog(deploymentId, "system", `Starting deployment for ${service.name}`);

  const secrets = await db.all("SELECT name, value FROM service_secrets WHERE service_id = ?", service.id);
  const env = { ...process.env };
  for (const secret of secrets) env[secret.name] = secret.value;

  const steps = service.deployment_steps.split(/\r?\n/).map(step => step.trim()).filter(Boolean);
  if (!steps.length) {
    await appendLog(deploymentId, "system", "No deployment steps configured.");
    await finishDeployment(deploymentId, "failed", 1);
    return;
  }

  for (const [index, step] of steps.entries()) {
    await appendLog(deploymentId, "system", `Step ${index + 1}/${steps.length}: ${step}`);
    const result = await runShellStep(deploymentId, step, service.working_dir || ROOT, env);
    if (result !== 0) {
      await appendLog(deploymentId, "system", `Deployment failed at step ${index + 1} with exit code ${result}.`);
      await finishDeployment(deploymentId, "failed", result);
      return;
    }
  }

  await appendLog(deploymentId, "system", "Deployment completed successfully.");
  await finishDeployment(deploymentId, "succeeded", 0);
}

function runShellStep(deploymentId, step, cwd, env) {
  return new Promise(resolve => {
    const child = spawn(step, {
      cwd,
      env,
      shell: true,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
      stdout = flushLines(deploymentId, "stdout", stdout);
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
      stderr = flushLines(deploymentId, "stderr", stderr);
    });
    child.on("error", async error => {
      await appendLog(deploymentId, "stderr", error.message);
      resolve(1);
    });
    child.on("close", async code => {
      if (stdout) await appendLog(deploymentId, "stdout", stdout);
      if (stderr) await appendLog(deploymentId, "stderr", stderr);
      resolve(code ?? 1);
    });
  });
}

function flushLines(deploymentId, stream, buffer) {
  const lines = buffer.split(/\r?\n/);
  const remainder = lines.pop() || "";
  for (const line of lines) appendLog(deploymentId, stream, line);
  return remainder;
}

app.get("/login", (req, res) => res.send(loginPage(req)));
app.post("/login", async (req, res) => {
  const user = await db.get("SELECT * FROM users WHERE email = ?", req.body.email || "");
  if (!user || !bcrypt.compareSync(req.body.password || "", user.password_hash)) {
    return res.status(401).send(loginPage(req, "Invalid email or password."));
  }
  req.session.user = { id: user.id, email: user.email, role: user.role };
  res.redirect("/");
});
app.post("/logout", (req, res) => req.session.destroy(() => res.redirect("/login")));

app.get("/", requireAuth, async (req, res) => res.send(await dashboardPage(req)));
app.get("/services/new", requireAuth, requireOperator, (req, res) => res.send(serviceForm(req)));
app.post("/services", requireAuth, requireOperator, async (req, res) => {
  await db.run(
    "INSERT INTO services (name, description, repository, working_dir, deployment_steps) VALUES (?, ?, ?, ?, ?)",
    req.body.name,
    req.body.description || "",
    req.body.repository || "",
    req.body.working_dir || "",
    req.body.deployment_steps || ""
  );
  res.redirect("/");
});
app.get("/services/:id", requireAuth, async (req, res) => res.send(await servicePage(req, req.params.id)));
app.get("/services/:id/edit", requireAuth, requireOperator, async (req, res) => {
  const service = await db.get("SELECT * FROM services WHERE id = ?", req.params.id);
  if (!service) return res.status(404).send(page(req, "Not found", "<main><h1>Service not found</h1></main>"));
  res.send(serviceForm(req, service));
});
app.post("/services/:id", requireAuth, requireOperator, async (req, res) => {
  await db.run(
    "UPDATE services SET name = ?, description = ?, repository = ?, working_dir = ?, deployment_steps = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    req.body.name,
    req.body.description || "",
    req.body.repository || "",
    req.body.working_dir || "",
    req.body.deployment_steps || "",
    req.params.id
  );
  res.redirect(`/services/${req.params.id}`);
});
app.post("/services/:id/secrets", requireAuth, requireOperator, async (req, res) => {
  await db.run(
    `INSERT INTO service_secrets (service_id, name, value, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(service_id, name) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    req.params.id,
    req.body.name,
    req.body.value
  );
  res.redirect(`/services/${req.params.id}`);
});
app.post("/services/:serviceId/secrets/:secretId/delete", requireAuth, requireOperator, async (req, res) => {
  await db.run("DELETE FROM service_secrets WHERE id = ? AND service_id = ?", req.params.secretId, req.params.serviceId);
  res.redirect(`/services/${req.params.serviceId}`);
});
app.post("/services/:id/deploy", requireAuth, requireOperator, async (req, res) => {
  const service = await db.get("SELECT * FROM services WHERE id = ?", req.params.id);
  if (!service) return res.status(404).send(page(req, "Not found", "<main><h1>Service not found</h1></main>"));
  const result = await db.run(
    "INSERT INTO deployments (service_id, triggered_by, status) VALUES (?, ?, 'queued')",
    service.id,
    req.session.user.id
  );
  runDeployment(result.lastID, service).catch(async error => {
    await appendLog(result.lastID, "stderr", error.stack || error.message);
    await finishDeployment(result.lastID, "failed", 1);
  });
  res.redirect(`/deployments/${result.lastID}`);
});
app.get("/deployments/:id", requireAuth, async (req, res) => res.send(await deploymentPage(req, req.params.id)));
app.get("/deployments/:id/stream", requireAuth, async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const id = Number(req.params.id);
  if (!liveStreams.has(id)) liveStreams.set(id, new Set());
  liveStreams.get(id).add(res);
  req.on("close", () => {
    const clients = liveStreams.get(id);
    if (!clients) return;
    clients.delete(res);
    if (!clients.size) liveStreams.delete(id);
  });
});

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`DevOps dashboard running on http://localhost:${PORT}`);
  });
});
