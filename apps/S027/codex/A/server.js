const path = require("path");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 5027;
const DB_PATH = path.join(__dirname, "todo.db");

const db = new sqlite3.Database(DB_PATH);

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
      completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
});

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ id: this.lastID, changes: this.changes });
      }
    });
  });
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "replace-this-secret-for-local-dev",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.error = null;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  next();
}

function cleanTitle(value) {
  return String(value || "").trim().slice(0, 200);
}

app.get("/", (req, res) => {
  if (req.session.user) {
    return res.redirect("/tasks");
  }
  res.redirect("/login");
});

app.get("/register", (req, res) => {
  res.render("register");
});

app.post("/register", async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (username.length < 3 || password.length < 6) {
      return res.status(400).render("register", {
        error: "Username must be at least 3 characters and password at least 6."
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await dbRun(
      "INSERT INTO users (username, password_hash) VALUES (?, ?)",
      [username, passwordHash]
    );

    req.session.user = { id: result.id, username };
    res.redirect("/tasks");
  } catch (err) {
    if (err && err.code === "SQLITE_CONSTRAINT") {
      return res.status(409).render("register", {
        error: "That username is already taken."
      });
    }
    next(err);
  }
});

app.get("/login", (req, res) => {
  res.render("login");
});

app.post("/login", async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const user = await dbGet("SELECT * FROM users WHERE username = ?", [username]);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).render("login", {
        error: "Invalid username or password."
      });
    }

    req.session.user = { id: user.id, username: user.username };
    res.redirect("/tasks");
  } catch (err) {
    next(err);
  }
});

app.post("/logout", (req, res, next) => {
  req.session.destroy((err) => {
    if (err) {
      return next(err);
    }
    res.clearCookie("connect.sid");
    res.redirect("/login");
  });
});

app.get("/tasks", requireAuth, async (req, res, next) => {
  try {
    const tasks = await dbAll(
      "SELECT * FROM tasks WHERE user_id = ? ORDER BY completed ASC, created_at DESC",
      [req.session.user.id]
    );
    res.render("tasks", { tasks, editingTask: null });
  } catch (err) {
    next(err);
  }
});

app.post("/tasks", requireAuth, async (req, res, next) => {
  try {
    const title = cleanTitle(req.body.title);
    if (title) {
      await dbRun("INSERT INTO tasks (user_id, title) VALUES (?, ?)", [
        req.session.user.id,
        title
      ]);
    }
    res.redirect("/tasks");
  } catch (err) {
    next(err);
  }
});

app.post("/tasks/:id/toggle", requireAuth, async (req, res, next) => {
  try {
    await dbRun(
      `UPDATE tasks
       SET completed = CASE completed WHEN 1 THEN 0 ELSE 1 END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [req.params.id, req.session.user.id]
    );
    res.redirect("/tasks");
  } catch (err) {
    next(err);
  }
});

app.get("/tasks/:id/edit", requireAuth, async (req, res, next) => {
  try {
    const editingTask = await dbGet(
      "SELECT * FROM tasks WHERE id = ? AND user_id = ?",
      [req.params.id, req.session.user.id]
    );
    if (!editingTask) {
      return res.redirect("/tasks");
    }
    const tasks = await dbAll(
      "SELECT * FROM tasks WHERE user_id = ? ORDER BY completed ASC, created_at DESC",
      [req.session.user.id]
    );
    res.render("tasks", { tasks, editingTask });
  } catch (err) {
    next(err);
  }
});

app.post("/tasks/:id/edit", requireAuth, async (req, res, next) => {
  try {
    const title = cleanTitle(req.body.title);
    if (title) {
      await dbRun(
        "UPDATE tasks SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
        [title, req.params.id, req.session.user.id]
      );
    }
    res.redirect("/tasks");
  } catch (err) {
    next(err);
  }
});

app.post("/tasks/:id/delete", requireAuth, async (req, res, next) => {
  try {
    await dbRun("DELETE FROM tasks WHERE id = ? AND user_id = ?", [
      req.params.id,
      req.session.user.id
    ]);
    res.redirect("/tasks");
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render("error", {
    message: "Something went wrong. Please try again."
  });
});

app.listen(PORT, () => {
  console.log(`To-do app listening on http://localhost:${PORT}`);
});
