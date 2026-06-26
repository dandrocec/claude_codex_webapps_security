const crypto = require("crypto");
const path = require("path");

const bcrypt = require("bcryptjs");
const cookieParser = require("cookie-parser");
const Database = require("better-sqlite3");
const express = require("express");
const jwt = require("jsonwebtoken");

const PORT = Number(process.env.PORT || 5096);
const JWT_SECRET = process.env.JWT_SECRET || "local-development-secret-change-me";
const DATABASE_PATH = process.env.DATABASE_PATH || path.join(__dirname, "..", "gateway.sqlite");

const app = express();
const db = new Database(DATABASE_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS developers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    developer_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    backend_url TEXT NOT NULL,
    rate_limit_per_minute INTEGER NOT NULL DEFAULT 60,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TEXT,
    FOREIGN KEY (developer_id) REFERENCES developers(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key_id INTEGER NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    bytes_in INTEGER NOT NULL DEFAULT 0,
    bytes_out INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_usage_api_key_created ON usage_events(api_key_id, created_at);
`);

const rateWindows = new Map();

function hashApiKey(apiKey) {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

function signDeveloper(developer) {
  return jwt.sign({ sub: developer.id, email: developer.email }, JWT_SECRET, { expiresIn: "7d" });
}

function readToken(req) {
  const auth = req.get("authorization") || "";
  if (auth.startsWith("Bearer ")) return auth.slice("Bearer ".length);
  return req.cookies.gateway_token;
}

function requireAuth(req, res, next) {
  try {
    const token = readToken(req);
    if (!token) return res.status(401).json({ error: "Authentication required." });
    req.developer = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session." });
  }
}

function publicKeyRow(row) {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    backendUrl: row.backend_url,
    rateLimitPerMinute: row.rate_limit_per_minute,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at
  };
}

function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      chunks.push(chunk);
    });
    req.on("end", () => resolve({ body: Buffer.concat(chunks), size }));
    req.on("error", reject);
  });
}

function applyRateLimit(apiKey) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const current = rateWindows.get(apiKey.id);

  if (!current || now - current.startedAt >= windowMs) {
    rateWindows.set(apiKey.id, { startedAt: now, count: 1 });
    return { allowed: true, remaining: Math.max(apiKey.rate_limit_per_minute - 1, 0), resetAt: now + windowMs };
  }

  if (current.count >= apiKey.rate_limit_per_minute) {
    return { allowed: false, remaining: 0, resetAt: current.startedAt + windowMs };
  }

  current.count += 1;
  return {
    allowed: true,
    remaining: Math.max(apiKey.rate_limit_per_minute - current.count, 0),
    resetAt: current.startedAt + windowMs
  };
}

async function proxyRequest(req, res) {
  const startedAt = Date.now();
  const apiKeyValue = req.get("x-api-key") || req.query.api_key;

  if (!apiKeyValue) {
    return res.status(401).json({ error: "Missing API key. Send it with the x-api-key header." });
  }

  const apiKey = db.prepare(`
    SELECT id, developer_id, backend_url, rate_limit_per_minute
    FROM api_keys
    WHERE key_hash = ? AND is_active = 1
  `).get(hashApiKey(apiKeyValue));

  if (!apiKey) {
    return res.status(401).json({ error: "Invalid API key." });
  }

  const limit = applyRateLimit(apiKey);
  res.set("x-ratelimit-limit", String(apiKey.rate_limit_per_minute));
  res.set("x-ratelimit-remaining", String(limit.remaining));
  res.set("x-ratelimit-reset", String(Math.ceil(limit.resetAt / 1000)));

  if (!limit.allowed) {
    db.prepare(`
      INSERT INTO usage_events (api_key_id, method, path, status_code, duration_ms)
      VALUES (?, ?, ?, ?, ?)
    `).run(apiKey.id, req.method, req.originalUrl, 429, Date.now() - startedAt);
    return res.status(429).json({ error: "Rate limit exceeded." });
  }

  const { body, size: bytesIn } = await getRequestBody(req);
  const backend = new URL(apiKey.backend_url);
  const incoming = new URL(req.url || "/", "http://gateway.local");
  const basePath = backend.pathname.replace(/\/$/, "");
  backend.pathname = `${basePath}${incoming.pathname}` || "/";
  backend.search = incoming.search;
  const target = backend;
  target.searchParams.delete("api_key");

  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (["host", "connection", "content-length", "x-api-key"].includes(name.toLowerCase())) continue;
    if (Array.isArray(value)) headers.set(name, value.join(","));
    else if (value !== undefined) headers.set(name, value);
  }

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
      redirect: "manual"
    });
    const responseBuffer = Buffer.from(await upstream.arrayBuffer());

    upstream.headers.forEach((value, name) => {
      if (!["connection", "content-encoding", "transfer-encoding"].includes(name.toLowerCase())) {
        res.setHeader(name, value);
      }
    });

    db.prepare(`
      INSERT INTO usage_events (api_key_id, method, path, status_code, duration_ms, bytes_in, bytes_out)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(apiKey.id, req.method, req.originalUrl, upstream.status, Date.now() - startedAt, bytesIn, responseBuffer.length);
    db.prepare("UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?").run(apiKey.id);

    return res.status(upstream.status).send(responseBuffer);
  } catch (error) {
    db.prepare(`
      INSERT INTO usage_events (api_key_id, method, path, status_code, duration_ms, bytes_in)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(apiKey.id, req.method, req.originalUrl, 502, Date.now() - startedAt, bytesIn);
    return res.status(502).json({ error: "Backend request failed.", details: error.message });
  }
}

app.use("/proxy", proxyRequest);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.get("/", (_req, res) => {
  res.type("html").send(DASHBOARD_HTML);
});

app.post("/api/register", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!email || password.length < 8) {
    return res.status(400).json({ error: "Email and a password of at least 8 characters are required." });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = db.prepare("INSERT INTO developers (email, password_hash) VALUES (?, ?)").run(email, passwordHash);
    const token = signDeveloper({ id: result.lastInsertRowid, email });
    res.cookie("gateway_token", token, { httpOnly: true, sameSite: "lax" });
    return res.status(201).json({ token, developer: { id: result.lastInsertRowid, email } });
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) return res.status(409).json({ error: "That email is already registered." });
    return res.status(500).json({ error: "Registration failed." });
  }
});

app.post("/api/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const developer = db.prepare("SELECT * FROM developers WHERE email = ?").get(email);

  if (!developer || !(await bcrypt.compare(password, developer.password_hash))) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const token = signDeveloper(developer);
  res.cookie("gateway_token", token, { httpOnly: true, sameSite: "lax" });
  return res.json({ token, developer: { id: developer.id, email: developer.email } });
});

app.post("/api/logout", (_req, res) => {
  res.clearCookie("gateway_token");
  res.status(204).end();
});

app.get("/api/me", requireAuth, (req, res) => {
  res.json({ developer: { id: req.developer.sub, email: req.developer.email } });
});

app.get("/api/keys", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, key_prefix, backend_url, rate_limit_per_minute, is_active, created_at, last_used_at
    FROM api_keys
    WHERE developer_id = ?
    ORDER BY created_at DESC
  `).all(req.developer.sub);
  res.json({ keys: rows.map(publicKeyRow) });
});

app.post("/api/keys", requireAuth, (req, res) => {
  const name = String(req.body.name || "").trim();
  const backendUrl = String(req.body.backendUrl || "").trim();
  const rateLimitPerMinute = Number(req.body.rateLimitPerMinute || 60);

  if (!name) return res.status(400).json({ error: "Key name is required." });
  if (!Number.isInteger(rateLimitPerMinute) || rateLimitPerMinute < 1 || rateLimitPerMinute > 100000) {
    return res.status(400).json({ error: "Rate limit must be an integer between 1 and 100000." });
  }

  try {
    const parsed = new URL(backendUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("bad protocol");
  } catch {
    return res.status(400).json({ error: "Backend URL must be a valid http or https URL." });
  }

  const plainKey = `gw_live_${crypto.randomBytes(27).toString("base64url")}`;
  const result = db.prepare(`
    INSERT INTO api_keys (developer_id, name, key_prefix, key_hash, backend_url, rate_limit_per_minute)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.developer.sub, name, plainKey.slice(0, 16), hashApiKey(plainKey), backendUrl, rateLimitPerMinute);

  const created = db.prepare(`
    SELECT id, name, key_prefix, backend_url, rate_limit_per_minute, is_active, created_at, last_used_at
    FROM api_keys
    WHERE id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json({ key: publicKeyRow(created), apiKey: plainKey });
});

app.patch("/api/keys/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM api_keys WHERE id = ? AND developer_id = ?").get(id, req.developer.sub);
  if (!existing) return res.status(404).json({ error: "API key not found." });

  const name = String(req.body.name ?? existing.name).trim();
  const backendUrl = String(req.body.backendUrl ?? existing.backend_url).trim();
  const rateLimitPerMinute = Number(req.body.rateLimitPerMinute ?? existing.rate_limit_per_minute);
  const isActive = req.body.isActive === undefined ? existing.is_active : req.body.isActive ? 1 : 0;

  try {
    const parsed = new URL(backendUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("bad protocol");
  } catch {
    return res.status(400).json({ error: "Backend URL must be a valid http or https URL." });
  }

  db.prepare(`
    UPDATE api_keys
    SET name = ?, backend_url = ?, rate_limit_per_minute = ?, is_active = ?
    WHERE id = ? AND developer_id = ?
  `).run(name, backendUrl, rateLimitPerMinute, isActive, id, req.developer.sub);

  const updated = db.prepare(`
    SELECT id, name, key_prefix, backend_url, rate_limit_per_minute, is_active, created_at, last_used_at
    FROM api_keys
    WHERE id = ?
  `).get(id);
  res.json({ key: publicKeyRow(updated) });
});

app.delete("/api/keys/:id", requireAuth, (req, res) => {
  db.prepare("DELETE FROM api_keys WHERE id = ? AND developer_id = ?").run(Number(req.params.id), req.developer.sub);
  res.status(204).end();
});

app.get("/api/usage", requireAuth, (req, res) => {
  const summary = db.prepare(`
    SELECT
      k.id,
      k.name,
      k.key_prefix AS keyPrefix,
      COUNT(u.id) AS requests,
      COALESCE(SUM(CASE WHEN u.status_code BETWEEN 200 AND 399 THEN 1 ELSE 0 END), 0) AS successful,
      COALESCE(SUM(CASE WHEN u.status_code = 429 THEN 1 ELSE 0 END), 0) AS rateLimited,
      COALESCE(ROUND(AVG(u.duration_ms)), 0) AS averageMs,
      COALESCE(SUM(u.bytes_out), 0) AS bytesOut
    FROM api_keys k
    LEFT JOIN usage_events u ON u.api_key_id = k.id
    WHERE k.developer_id = ?
    GROUP BY k.id
    ORDER BY requests DESC, k.created_at DESC
  `).all(req.developer.sub);

  const recent = db.prepare(`
    SELECT u.created_at AS createdAt, k.name, k.key_prefix AS keyPrefix, u.method, u.path, u.status_code AS statusCode,
           u.duration_ms AS durationMs, u.bytes_in AS bytesIn, u.bytes_out AS bytesOut
    FROM usage_events u
    JOIN api_keys k ON k.id = u.api_key_id
    WHERE k.developer_id = ?
    ORDER BY u.created_at DESC
    LIMIT 50
  `).all(req.developer.sub);

  res.json({ summary, recent });
});

app.listen(PORT, () => {
  console.log(`API gateway listening on http://localhost:${PORT}`);
});

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>API Gateway Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --ink: #17202a;
      --muted: #657282;
      --line: #dfe4ea;
      --brand: #0f766e;
      --brand-dark: #115e59;
      --danger: #b42318;
      --shadow: 0 14px 30px rgba(25, 34, 45, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--ink);
    }
    header {
      background: #102026;
      color: white;
      padding: 22px clamp(18px, 4vw, 44px);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
    }
    header h1 { font-size: 22px; margin: 0; letter-spacing: 0; }
    header p { margin: 4px 0 0; color: #bad0d2; font-size: 14px; }
    main { width: min(1180px, calc(100% - 32px)); margin: 28px auto 48px; }
    .grid { display: grid; grid-template-columns: 360px 1fr; gap: 20px; align-items: start; }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
    }
    .panel h2 { margin: 0 0 14px; font-size: 18px; }
    .panel-body { padding: 20px; }
    label { display: block; font-size: 13px; color: var(--muted); margin: 12px 0 6px; }
    input {
      width: 100%;
      min-height: 42px;
      border: 1px solid #cfd7df;
      border-radius: 6px;
      padding: 10px 11px;
      font: inherit;
      background: #fff;
    }
    button {
      border: 0;
      border-radius: 6px;
      padding: 10px 14px;
      min-height: 40px;
      font-weight: 700;
      cursor: pointer;
      background: var(--brand);
      color: white;
    }
    button:hover { background: var(--brand-dark); }
    button.secondary { background: #e8edf2; color: #1d2935; }
    button.secondary:hover { background: #dce4eb; }
    button.danger { background: var(--danger); }
    .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .stack { display: grid; gap: 14px; }
    .muted { color: var(--muted); }
    .hidden { display: none !important; }
    .notice {
      padding: 12px;
      border-radius: 6px;
      background: #ecfdf3;
      border: 1px solid #a6f4c5;
      color: #05603a;
      overflow-wrap: anywhere;
    }
    .error {
      padding: 12px;
      border-radius: 6px;
      background: #fff1f0;
      border: 1px solid #f5b5ae;
      color: #9b1c13;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    th, td {
      padding: 11px 10px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
    }
    th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
    code {
      background: #edf2f7;
      padding: 2px 5px;
      border-radius: 4px;
      overflow-wrap: anywhere;
    }
    .metric-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    .metric {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      background: #fbfcfd;
    }
    .metric strong { display: block; font-size: 24px; margin-bottom: 4px; }
    @media (max-width: 900px) {
      .grid { grid-template-columns: 1fr; }
      .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 560px) {
      header { align-items: flex-start; flex-direction: column; }
      .metric-grid { grid-template-columns: 1fr; }
      table { display: block; overflow-x: auto; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>API Gateway Dashboard</h1>
      <p>Register developers, issue API keys, proxy traffic, and track per-key usage.</p>
    </div>
    <button id="logoutButton" class="secondary hidden">Log out</button>
  </header>
  <main>
    <div id="message"></div>
    <section id="authView" class="grid">
      <div class="panel">
        <div class="panel-body">
          <h2>Create developer account</h2>
          <form id="registerForm">
            <label>Email</label>
            <input name="email" type="email" required>
            <label>Password</label>
            <input name="password" type="password" minlength="8" required>
            <p><button type="submit">Register</button></p>
          </form>
        </div>
      </div>
      <div class="panel">
        <div class="panel-body">
          <h2>Log in</h2>
          <form id="loginForm">
            <label>Email</label>
            <input name="email" type="email" required>
            <label>Password</label>
            <input name="password" type="password" required>
            <p><button type="submit">Log in</button></p>
          </form>
        </div>
      </div>
    </section>

    <section id="dashboardView" class="hidden stack">
      <div class="metric-grid" id="metrics"></div>
      <div class="grid">
        <div class="panel">
          <div class="panel-body">
            <h2>Generate API key</h2>
            <form id="keyForm">
              <label>Key name</label>
              <input name="name" placeholder="Production mobile app" required>
              <label>Backend URL</label>
              <input name="backendUrl" placeholder="https://api.example.com" required>
              <label>Requests per minute</label>
              <input name="rateLimitPerMinute" type="number" min="1" max="100000" value="60" required>
              <p><button type="submit">Generate key</button></p>
            </form>
            <p class="muted">Clients call <code>/proxy/anything</code> with <code>x-api-key</code>. The path is forwarded to the configured backend.</p>
          </div>
        </div>
        <div class="panel">
          <div class="panel-body">
            <div class="row" style="justify-content: space-between;">
              <h2>API keys</h2>
              <button class="secondary" id="refreshButton">Refresh</button>
            </div>
            <div id="keysTable"></div>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-body">
          <h2>Recent usage</h2>
          <div id="usageTable"></div>
        </div>
      </div>
    </section>
  </main>
  <script>
    const message = document.querySelector("#message");
    const authView = document.querySelector("#authView");
    const dashboardView = document.querySelector("#dashboardView");
    const logoutButton = document.querySelector("#logoutButton");

    function showMessage(text, kind = "notice") {
      message.innerHTML = text ? '<p class="' + kind + '">' + text + '</p>' : "";
    }

    async function api(path, options = {}) {
      const response = await fetch(path, {
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...(options.headers || {}) },
        ...options
      });
      if (response.status === 204) return null;
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Request failed.");
      return data;
    }

    function formData(form) {
      return Object.fromEntries(new FormData(form).entries());
    }

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[char]));
    }

    function renderKeys(keys) {
      if (!keys.length) {
        document.querySelector("#keysTable").innerHTML = '<p class="muted">No keys yet.</p>';
        return;
      }
      document.querySelector("#keysTable").innerHTML = '<table><thead><tr><th>Name</th><th>Prefix</th><th>Backend</th><th>Limit</th><th>Status</th><th></th></tr></thead><tbody>' +
        keys.map(key => '<tr><td>' + escapeHtml(key.name) + '</td><td><code>' + escapeHtml(key.keyPrefix) + '</code></td><td>' + escapeHtml(key.backendUrl) + '</td><td>' + key.rateLimitPerMinute + '/min</td><td>' + (key.isActive ? 'Active' : 'Disabled') + '</td><td><button class="danger" data-delete="' + key.id + '">Delete</button></td></tr>').join("") +
        '</tbody></table>';
    }

    function renderUsage(usage) {
      const totals = usage.summary.reduce((acc, row) => {
        acc.requests += row.requests;
        acc.successful += row.successful;
        acc.rateLimited += row.rateLimited;
        acc.bytesOut += row.bytesOut;
        return acc;
      }, { requests: 0, successful: 0, rateLimited: 0, bytesOut: 0 });
      document.querySelector("#metrics").innerHTML =
        '<div class="metric"><strong>' + totals.requests + '</strong><span class="muted">Total requests</span></div>' +
        '<div class="metric"><strong>' + totals.successful + '</strong><span class="muted">Successful</span></div>' +
        '<div class="metric"><strong>' + totals.rateLimited + '</strong><span class="muted">Rate limited</span></div>' +
        '<div class="metric"><strong>' + Math.round(totals.bytesOut / 1024) + ' KB</strong><span class="muted">Response data</span></div>';

      if (!usage.recent.length) {
        document.querySelector("#usageTable").innerHTML = '<p class="muted">No proxied requests recorded yet.</p>';
        return;
      }
      document.querySelector("#usageTable").innerHTML = '<table><thead><tr><th>Time</th><th>Key</th><th>Request</th><th>Status</th><th>Duration</th><th>Bytes</th></tr></thead><tbody>' +
        usage.recent.map(row => '<tr><td>' + escapeHtml(row.createdAt) + '</td><td>' + escapeHtml(row.name) + '<br><code>' + escapeHtml(row.keyPrefix) + '</code></td><td>' + escapeHtml(row.method) + ' ' + escapeHtml(row.path) + '</td><td>' + row.statusCode + '</td><td>' + row.durationMs + ' ms</td><td>' + row.bytesOut + '</td></tr>').join("") +
        '</tbody></table>';
    }

    async function loadDashboard() {
      const [keys, usage] = await Promise.all([api("/api/keys"), api("/api/usage")]);
      renderKeys(keys.keys);
      renderUsage(usage);
    }

    async function showDashboard() {
      authView.classList.add("hidden");
      dashboardView.classList.remove("hidden");
      logoutButton.classList.remove("hidden");
      await loadDashboard();
    }

    async function bootstrap() {
      try {
        await api("/api/me");
        await showDashboard();
      } catch {
        authView.classList.remove("hidden");
        dashboardView.classList.add("hidden");
        logoutButton.classList.add("hidden");
      }
    }

    document.querySelector("#registerForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api("/api/register", { method: "POST", body: JSON.stringify(formData(event.target)) });
        showMessage("");
        await showDashboard();
      } catch (error) {
        showMessage(error.message, "error");
      }
    });

    document.querySelector("#loginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api("/api/login", { method: "POST", body: JSON.stringify(formData(event.target)) });
        showMessage("");
        await showDashboard();
      } catch (error) {
        showMessage(error.message, "error");
      }
    });

    document.querySelector("#keyForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const data = formData(event.target);
        data.rateLimitPerMinute = Number(data.rateLimitPerMinute);
        const created = await api("/api/keys", { method: "POST", body: JSON.stringify(data) });
        showMessage('API key generated. Copy it now: <code>' + escapeHtml(created.apiKey) + '</code>');
        event.target.reset();
        event.target.rateLimitPerMinute.value = 60;
        await loadDashboard();
      } catch (error) {
        showMessage(error.message, "error");
      }
    });

    document.querySelector("#keysTable").addEventListener("click", async (event) => {
      const id = event.target.dataset.delete;
      if (!id) return;
      await api("/api/keys/" + id, { method: "DELETE" });
      await loadDashboard();
    });

    document.querySelector("#refreshButton").addEventListener("click", loadDashboard);
    logoutButton.addEventListener("click", async () => {
      await api("/api/logout", { method: "POST" });
      location.reload();
    });

    bootstrap();
  </script>
</body>
</html>`;
