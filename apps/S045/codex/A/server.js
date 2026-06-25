const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const bcrypt = require("bcrypt");
const Database = require("better-sqlite3");
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const multer = require("multer");

const app = express();
const PORT = Number(process.env.PORT || 5045);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_PATH = path.join(DATA_DIR, "app.db");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const id = crypto.randomBytes(18).toString("hex");
      const ext = path.extname(file.originalname || "").slice(0, 32);
      cb(null, `${id}${ext}`);
    }
  }),
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});

app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    store: new SQLiteStore({ db: "sessions.db", dir: DATA_DIR }),
    secret: process.env.SESSION_SECRET || "change-this-secret-for-local-development",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function page(title, body, user = null) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.5;
      color: #17202a;
      background: #f4f7fb;
    }
    * { box-sizing: border-box; }
    body { margin: 0; }
    header {
      background: #ffffff;
      border-bottom: 1px solid #d9e2ec;
      padding: 16px 24px;
    }
    header .bar {
      max-width: 900px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    main {
      max-width: 900px;
      margin: 32px auto;
      padding: 0 24px;
    }
    h1 { margin: 0; font-size: 1.35rem; }
    h2 { margin: 0 0 16px; font-size: 1.1rem; }
    a { color: #0969da; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .panel {
      background: #ffffff;
      border: 1px solid #d9e2ec;
      border-radius: 8px;
      padding: 22px;
      margin-bottom: 20px;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 20px;
    }
    label { display: block; font-weight: 700; margin-bottom: 6px; }
    input[type="text"], input[type="password"], input[type="file"] {
      width: 100%;
      border: 1px solid #b7c4d3;
      border-radius: 6px;
      padding: 10px 12px;
      margin-bottom: 14px;
      font: inherit;
      background: #ffffff;
    }
    button, .button {
      appearance: none;
      border: 0;
      border-radius: 6px;
      background: #116149;
      color: #ffffff;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 42px;
      padding: 0 15px;
      font: inherit;
      font-weight: 700;
      text-decoration: none;
    }
    button:hover, .button:hover { background: #0d4f3b; text-decoration: none; }
    .secondary { background: #52616f; }
    .secondary:hover { background: #3f4c57; }
    .danger { background: #a43f32; }
    .danger:hover { background: #843126; }
    .message {
      border-radius: 6px;
      padding: 10px 12px;
      margin-bottom: 18px;
      background: #e8f3ff;
      border: 1px solid #acd0f7;
    }
    .error {
      background: #fff1f0;
      border-color: #f0a8a1;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      border-bottom: 1px solid #e1e8f0;
      padding: 11px 8px;
      text-align: left;
      vertical-align: top;
      overflow-wrap: anywhere;
    }
    th { font-size: 0.85rem; color: #52616f; }
    .actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .muted { color: #607080; }
    @media (max-width: 640px) {
      header .bar { align-items: flex-start; flex-direction: column; }
      main { margin-top: 20px; padding: 0 16px; }
      .panel { padding: 18px; }
      table, thead, tbody, th, td, tr { display: block; }
      thead { display: none; }
      tr { border-bottom: 1px solid #e1e8f0; padding: 10px 0; }
      td { border: 0; padding: 4px 0; }
      td::before { content: attr(data-label); display: block; font-size: 0.78rem; font-weight: 700; color: #607080; }
    }
  </style>
</head>
<body>
  <header>
    <div class="bar">
      <h1><a href="/">File Share</a></h1>
      <nav class="actions">
        ${user ? `<span class="muted">Signed in as ${escapeHtml(user.username)}</span><form method="post" action="/logout"><button class="secondary" type="submit">Sign out</button></form>` : `<a href="/login">Sign in</a><a class="button" href="/register">Create account</a>`}
      </nav>
    </div>
  </header>
  <main>${body}</main>
</body>
</html>`;
}

function getCurrentUser(req) {
  if (!req.session.userId) return null;
  return db.prepare("SELECT id, username FROM users WHERE id = ?").get(req.session.userId) || null;
}

function requireUser(req, res, next) {
  const user = getCurrentUser(req);
  if (!user) {
    res.redirect("/login");
    return;
  }
  req.user = user;
  next();
}

function authForm(kind, message = "", isError = false) {
  const isRegister = kind === "register";
  const title = isRegister ? "Create account" : "Sign in";
  const action = isRegister ? "/register" : "/login";
  const switchLink = isRegister
    ? `Already have an account? <a href="/login">Sign in</a>.`
    : `Need an account? <a href="/register">Create one</a>.`;

  return page(
    title,
    `<section class="panel">
      <h2>${title}</h2>
      ${message ? `<div class="message ${isError ? "error" : ""}">${escapeHtml(message)}</div>` : ""}
      <form method="post" action="${action}">
        <label for="username">Username</label>
        <input id="username" name="username" type="text" autocomplete="username" minlength="3" maxlength="40" required>
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="${isRegister ? "new-password" : "current-password"}" minlength="8" required>
        <button type="submit">${title}</button>
      </form>
      <p class="muted">${switchLink}</p>
    </section>`
  );
}

app.get("/", requireUser, (req, res) => {
  const files = db
    .prepare("SELECT id, original_name, mime_type, size, uploaded_at FROM files WHERE user_id = ? ORDER BY uploaded_at DESC, id DESC")
    .all(req.user.id);

  const rows = files
    .map(
      file => `<tr>
        <td data-label="File">${escapeHtml(file.original_name)}</td>
        <td data-label="Type">${escapeHtml(file.mime_type || "application/octet-stream")}</td>
        <td data-label="Size">${formatBytes(file.size)}</td>
        <td data-label="Uploaded">${escapeHtml(file.uploaded_at)}</td>
        <td data-label="Actions"><a href="/files/${file.id}/download">Download</a></td>
      </tr>`
    )
    .join("");

  res.send(
    page(
      "Your files",
      `<section class="panel">
        <h2>Upload a file</h2>
        <form method="post" action="/upload" enctype="multipart/form-data">
          <label for="file">Choose file</label>
          <input id="file" name="file" type="file" required>
          <button type="submit">Upload</button>
        </form>
      </section>
      <section class="panel">
        <h2>Your uploads</h2>
        ${
          files.length
            ? `<table>
                <thead><tr><th>File</th><th>Type</th><th>Size</th><th>Uploaded</th><th>Actions</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>`
            : `<p class="muted">No files uploaded yet.</p>`
        }
      </section>`,
      req.user
    )
  );
});

app.get("/register", (req, res) => {
  if (getCurrentUser(req)) return res.redirect("/");
  res.send(authForm("register"));
});

app.post("/register", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) {
    res.status(400).send(authForm("register", "Use 3-40 letters, numbers, dots, underscores, or hyphens for the username.", true));
    return;
  }
  if (password.length < 8) {
    res.status(400).send(authForm("register", "Password must be at least 8 characters.", true));
    return;
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, passwordHash);
    req.session.userId = result.lastInsertRowid;
    res.redirect("/");
  } catch (error) {
    const message = error.code === "SQLITE_CONSTRAINT_UNIQUE" ? "That username is already taken." : "Unable to create the account.";
    res.status(400).send(authForm("register", message, true));
  }
});

app.get("/login", (req, res) => {
  if (getCurrentUser(req)) return res.redirect("/");
  res.send(authForm("login"));
});

app.post("/login", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT id, username, password_hash FROM users WHERE username = ?").get(username);

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    res.status(401).send(authForm("login", "Invalid username or password.", true));
    return;
  }

  req.session.regenerate(error => {
    if (error) {
      res.status(500).send(page("Session error", `<section class="panel"><p>Unable to start a session.</p></section>`));
      return;
    }
    req.session.userId = user.id;
    res.redirect("/");
  });
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

app.post("/upload", requireUser, upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).send(page("Upload error", `<section class="panel"><p>No file was uploaded.</p><p><a href="/">Back to files</a></p></section>`, req.user));
    return;
  }

  db.prepare(
    "INSERT INTO files (user_id, original_name, stored_name, mime_type, size) VALUES (?, ?, ?, ?, ?)"
  ).run(req.user.id, req.file.originalname, req.file.filename, req.file.mimetype || "application/octet-stream", req.file.size);

  res.redirect("/");
});

app.get("/files/:id/download", requireUser, (req, res) => {
  const file = db
    .prepare("SELECT original_name, stored_name FROM files WHERE id = ? AND user_id = ?")
    .get(Number(req.params.id), req.user.id);

  if (!file) {
    res.status(404).send(page("Not found", `<section class="panel"><p>File not found.</p><p><a href="/">Back to files</a></p></section>`, req.user));
    return;
  }

  const diskPath = path.join(UPLOAD_DIR, file.stored_name);
  if (!diskPath.startsWith(UPLOAD_DIR + path.sep)) {
    res.status(400).send(page("Invalid file", `<section class="panel"><p>Invalid file path.</p></section>`, req.user));
    return;
  }

  res.download(diskPath, file.original_name, error => {
    if (error && !res.headersSent) {
      res.status(404).send(page("Missing file", `<section class="panel"><p>The file is missing from disk.</p><p><a href="/">Back to files</a></p></section>`, req.user));
    }
  });
});

app.use((error, req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    const user = getCurrentUser(req);
    res.status(413).send(page("Upload too large", `<section class="panel"><p>Files are limited to 50 MB.</p><p><a href="/">Back to files</a></p></section>`, user));
    return;
  }

  console.error(error);
  res.status(500).send(page("Server error", `<section class="panel"><p>Something went wrong.</p></section>`, getCurrentUser(req)));
});

app.listen(PORT, () => {
  console.log(`File Share is running at http://localhost:${PORT}`);
});
