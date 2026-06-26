const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const sqlite3 = require("sqlite3").verbose();

const PORT = Number(process.env.PORT || 5056);
const JWT_SECRET = process.env.JWT_SECRET || "replace-this-secret-in-production";
const DB_FILE = process.env.DB_FILE || "tasks.sqlite";

const app = express();
const db = new sqlite3.Database(DB_FILE);

app.use(express.json());

db.serialize(() => {
  db.run("PRAGMA foreign_keys = ON");
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) reject(error);
      else resolve(rows);
    });
  });
}

function taskResponse(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    done: Boolean(row.done),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function validateCredentials(req, res) {
  const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";

  if (username.length < 3 || username.length > 64) {
    res.status(400).json({ error: "Username must be between 3 and 64 characters" });
    return null;
  }

  if (password.length < 8 || password.length > 128) {
    res.status(400).json({ error: "Password must be between 8 and 128 characters" });
    return null;
  }

  return { username, password };
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/register", async (req, res) => {
  const credentials = validateCredentials(req, res);
  if (!credentials) return;

  try {
    const passwordHash = await bcrypt.hash(credentials.password, 12);
    const result = await run(
      "INSERT INTO users (username, password_hash) VALUES (?, ?)",
      [credentials.username, passwordHash]
    );

    const token = jwt.sign(
      { id: result.id, username: credentials.username },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      user: { id: result.id, username: credentials.username },
      token
    });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT") {
      res.status(409).json({ error: "Username already exists" });
      return;
    }
    res.status(500).json({ error: "Failed to register user" });
  }
});

app.post("/login", async (req, res) => {
  const credentials = validateCredentials(req, res);
  if (!credentials) return;

  try {
    const user = await get("SELECT * FROM users WHERE username = ?", [credentials.username]);
    if (!user) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const passwordMatches = await bcrypt.compare(credentials.password, user.password_hash);
    if (!passwordMatches) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      user: { id: user.id, username: user.username },
      token
    });
  } catch {
    res.status(500).json({ error: "Failed to log in" });
  }
});

app.get("/tasks", requireAuth, async (req, res) => {
  try {
    const rows = await all(
      "SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC, id DESC",
      [req.user.id]
    );
    res.json(rows.map(taskResponse));
  } catch {
    res.status(500).json({ error: "Failed to load tasks" });
  }
});

app.post("/tasks", requireAuth, async (req, res) => {
  const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
  const description = typeof req.body.description === "string" ? req.body.description.trim() : "";
  const done = typeof req.body.done === "boolean" ? req.body.done : false;

  if (!title || title.length > 200) {
    res.status(400).json({ error: "Title is required and must be 200 characters or fewer" });
    return;
  }

  try {
    const result = await run(
      "INSERT INTO tasks (user_id, title, description, done) VALUES (?, ?, ?, ?)",
      [req.user.id, title, description, done ? 1 : 0]
    );
    const row = await get("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [result.id, req.user.id]);
    res.status(201).json(taskResponse(row));
  } catch {
    res.status(500).json({ error: "Failed to create task" });
  }
});

app.get("/tasks/:id", requireAuth, async (req, res) => {
  try {
    const row = await get(
      "SELECT * FROM tasks WHERE id = ? AND user_id = ?",
      [req.params.id, req.user.id]
    );

    if (!row) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    res.json(taskResponse(row));
  } catch {
    res.status(500).json({ error: "Failed to load task" });
  }
});

app.put("/tasks/:id", requireAuth, async (req, res) => {
  const current = await get(
    "SELECT * FROM tasks WHERE id = ? AND user_id = ?",
    [req.params.id, req.user.id]
  ).catch(() => null);

  if (!current) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const title = Object.prototype.hasOwnProperty.call(req.body, "title")
    ? String(req.body.title).trim()
    : current.title;
  const description = Object.prototype.hasOwnProperty.call(req.body, "description")
    ? String(req.body.description).trim()
    : current.description;
  const done = Object.prototype.hasOwnProperty.call(req.body, "done")
    ? Boolean(req.body.done)
    : Boolean(current.done);

  if (!title || title.length > 200) {
    res.status(400).json({ error: "Title must be 1 to 200 characters" });
    return;
  }

  try {
    await run(
      `
        UPDATE tasks
        SET title = ?, description = ?, done = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `,
      [title, description, done ? 1 : 0, req.params.id, req.user.id]
    );
    const row = await get("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
    res.json(taskResponse(row));
  } catch {
    res.status(500).json({ error: "Failed to update task" });
  }
});

app.delete("/tasks/:id", requireAuth, async (req, res) => {
  try {
    const result = await run(
      "DELETE FROM tasks WHERE id = ? AND user_id = ?",
      [req.params.id, req.user.id]
    );

    if (result.changes === 0) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    res.status(204).send();
  } catch {
    res.status(500).json({ error: "Failed to delete task" });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.listen(PORT, () => {
  console.log(`Task API listening on port ${PORT}`);
});
