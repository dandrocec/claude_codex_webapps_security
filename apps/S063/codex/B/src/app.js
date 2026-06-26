require("dotenv").config();

const path = require("path");
const bcrypt = require("bcrypt");
const express = require("express");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const csrf = require("csurf");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { body, validationResult } = require("express-validator");
const sanitizeHtml = require("sanitize-html");
const db = require("./db");

const SQLiteStore = SQLiteStoreFactory(session);
const app = express();
const isProduction = process.env.NODE_ENV === "production";
const cookieSecure = process.env.COOKIE_SECURE !== "false";

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: isProduction ? "1h" : 0 }));

app.use(session({
  name: "sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({
    db: "sessions.sqlite",
    dir: path.join(__dirname, "..", "data")
  }),
  cookie: {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8
  }
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: true,
  legacyHeaders: false
});

const csrfProtection = csrf();
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.csrfToken = "";
  res.locals.errors = [];
  res.locals.form = {};
  next();
});
app.use(csrfProtection);
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  next();
});

function clean(value) {
  return sanitizeHtml(String(value || "").trim(), {
    allowedTags: [],
    allowedAttributes: {}
  });
}

function handleValidation(req, res, view, status = 422) {
  const result = validationResult(req);
  if (result.isEmpty()) {
    return null;
  }
  res.status(status).render(view, {
    errors: result.array().map((error) => error.msg),
    form: req.body
  });
  return true;
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  return next();
}

function userById(id) {
  return db.prepare("SELECT id, username, display_name, bio, created_at FROM users WHERE id = ?").get(id);
}

function refreshSessionUser(req) {
  req.session.user = userById(req.session.user.id);
}

app.get("/", (req, res) => {
  if (req.session.user) {
    return res.redirect("/feed");
  }
  return res.render("home");
});

app.get("/register", (req, res) => res.render("register"));

app.post(
  "/register",
  authLimiter,
  body("username").trim().isLength({ min: 3, max: 24 }).withMessage("Username must be 3-24 characters.")
    .matches(/^[a-zA-Z0-9_]+$/).withMessage("Username may contain letters, numbers, and underscores only."),
  body("password").isLength({ min: 12, max: 128 }).withMessage("Password must be at least 12 characters."),
  body("display_name").trim().isLength({ min: 1, max: 60 }).withMessage("Display name is required."),
  (req, res, next) => {
    if (handleValidation(req, res, "register")) return;
    const username = clean(req.body.username);
    const displayName = clean(req.body.display_name);
    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
    if (existing) {
      return res.status(409).render("register", {
        errors: ["That username is already taken."],
        form: req.body
      });
    }
    bcrypt.hash(req.body.password, 12, (err, hash) => {
      if (err) return next(err);
      const info = db.prepare(
        "INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)"
      ).run(username, hash, displayName);
      req.session.regenerate((sessionErr) => {
        if (sessionErr) return next(sessionErr);
        req.session.user = userById(info.lastInsertRowid);
        return res.redirect("/profile/edit");
      });
    });
  }
);

app.get("/login", (req, res) => res.render("login"));

app.post(
  "/login",
  authLimiter,
  body("username").trim().notEmpty().withMessage("Username is required."),
  body("password").notEmpty().withMessage("Password is required."),
  (req, res, next) => {
    if (handleValidation(req, res, "login", 400)) return;
    const username = clean(req.body.username);
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
    bcrypt.compare(req.body.password, user ? user.password_hash : "", (err, ok) => {
      if (err) return next(err);
      if (!user || !ok) {
        return res.status(401).render("login", {
          errors: ["Invalid username or password."],
          form: { username }
        });
      }
      req.session.regenerate((sessionErr) => {
        if (sessionErr) return next(sessionErr);
        req.session.user = userById(user.id);
        return res.redirect("/feed");
      });
    });
  }
);

app.post("/logout", requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("sid");
    return res.redirect("/");
  });
});

app.get("/feed", requireAuth, (req, res) => {
  const posts = db.prepare(`
    SELECT posts.id, posts.body, posts.created_at, users.id AS user_id, users.username, users.display_name
    FROM posts
    JOIN users ON users.id = posts.user_id
    WHERE posts.user_id = ?
       OR posts.user_id IN (SELECT followed_id FROM follows WHERE follower_id = ?)
    ORDER BY posts.created_at DESC, posts.id DESC
    LIMIT 100
  `).all(req.session.user.id, req.session.user.id);
  res.render("feed", { posts });
});

app.post(
  "/posts",
  requireAuth,
  body("body").trim().isLength({ min: 1, max: 280 }).withMessage("Post must be 1-280 characters."),
  (req, res) => {
    const result = validationResult(req);
    if (!result.isEmpty()) {
      const posts = db.prepare(`
        SELECT posts.id, posts.body, posts.created_at, users.id AS user_id, users.username, users.display_name
        FROM posts JOIN users ON users.id = posts.user_id
        WHERE posts.user_id = ? OR posts.user_id IN (SELECT followed_id FROM follows WHERE follower_id = ?)
        ORDER BY posts.created_at DESC, posts.id DESC LIMIT 100
      `).all(req.session.user.id, req.session.user.id);
      return res.status(422).render("feed", {
        errors: result.array().map((error) => error.msg),
        form: req.body,
        posts
      });
    }
    db.prepare("INSERT INTO posts (user_id, body) VALUES (?, ?)").run(req.session.user.id, clean(req.body.body));
    return res.redirect("/feed");
  }
);

app.post("/posts/:id/delete", requireAuth, (req, res) => {
  db.prepare("DELETE FROM posts WHERE id = ? AND user_id = ?").run(req.params.id, req.session.user.id);
  res.redirect("/feed");
});

app.get("/profile/edit", requireAuth, (req, res) => {
  res.render("edit-profile", { form: req.session.user });
});

app.post(
  "/profile/edit",
  requireAuth,
  body("display_name").trim().isLength({ min: 1, max: 60 }).withMessage("Display name is required."),
  body("bio").trim().isLength({ max: 240 }).withMessage("Bio must be 240 characters or less."),
  (req, res) => {
    if (handleValidation(req, res, "edit-profile")) return;
    db.prepare("UPDATE users SET display_name = ?, bio = ? WHERE id = ?")
      .run(clean(req.body.display_name), clean(req.body.bio), req.session.user.id);
    refreshSessionUser(req);
    res.redirect(`/users/${req.session.user.id}`);
  }
);

app.get("/users", requireAuth, (req, res) => {
  const search = clean(req.query.q || "");
  const users = search
    ? db.prepare(`
        SELECT id, username, display_name, bio FROM users
        WHERE id != ? AND (username LIKE ? OR display_name LIKE ?)
        ORDER BY username LIMIT 50
      `).all(req.session.user.id, `%${search}%`, `%${search}%`)
    : db.prepare("SELECT id, username, display_name, bio FROM users WHERE id != ? ORDER BY username LIMIT 50")
        .all(req.session.user.id);
  const following = db.prepare("SELECT followed_id FROM follows WHERE follower_id = ?")
    .all(req.session.user.id)
    .map((row) => row.followed_id);
  res.render("users", { users, following, search });
});

app.get("/users/:id", requireAuth, (req, res, next) => {
  const profile = userById(req.params.id);
  if (!profile) return next();
  const isFollowing = Boolean(db.prepare(
    "SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?"
  ).get(req.session.user.id, profile.id));
  const posts = db.prepare(`
    SELECT id, body, created_at FROM posts
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 50
  `).all(profile.id);
  res.render("profile", { profile, isFollowing, posts });
});

app.post("/users/:id/follow", requireAuth, (req, res) => {
  const targetId = Number(req.params.id);
  if (Number.isInteger(targetId) && targetId !== req.session.user.id && userById(targetId)) {
    db.prepare("INSERT OR IGNORE INTO follows (follower_id, followed_id) VALUES (?, ?)")
      .run(req.session.user.id, targetId);
  }
  res.redirect(`/users/${targetId}`);
});

app.post("/users/:id/unfollow", requireAuth, (req, res) => {
  const targetId = Number(req.params.id);
  db.prepare("DELETE FROM follows WHERE follower_id = ? AND followed_id = ?")
    .run(req.session.user.id, targetId);
  res.redirect(`/users/${targetId}`);
});

app.use((req, res) => {
  res.status(404).render("error", { message: "Page not found." });
});

app.use((err, req, res, next) => {
  res.locals.currentUser = req.session ? req.session.user || null : null;
  res.locals.csrfToken = "";
  res.locals.errors = [];
  res.locals.form = {};
  if (err.code === "EBADCSRFTOKEN") {
    return res.status(403).render("error", { message: "Invalid or expired form token." });
  }
  console.error(err);
  return res.status(500).render("error", { message: "Something went wrong." });
});

module.exports = app;
