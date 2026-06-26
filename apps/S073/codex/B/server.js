require("dotenv").config();

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const helmet = require("helmet");
const csrf = require("csurf");
const multer = require("multer");
const bcrypt = require("bcrypt");
const Database = require("better-sqlite3");
const { body, param, validationResult } = require("express-validator");
const rateLimit = require("express-rate-limit");
const sanitizeHtml = require("sanitize-html");
const FileType = require("file-type");
const mime = require("mime-types");

const app = express();
const PORT = Number(process.env.PORT || 5073);
const SESSION_SECRET = process.env.SESSION_SECRET;
const isProduction = process.env.NODE_ENV === "production";
const cookieSecure = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE !== "false"
  : isProduction;
const sessionCookieName = cookieSecure ? "__Host-photo_session" : "photo_session";

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.warn("SESSION_SECRET should be set to a random value of at least 32 characters.");
}

const dataDir = path.join(__dirname, "data");
const uploadDir = path.join(dataDir, "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const db = new Database(path.join(dataDir, "app.db"));
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL,
  followed_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (follower_id, followed_id),
  FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (followed_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (follower_id <> followed_id)
);
CREATE TABLE IF NOT EXISTS likes (
  user_id INTEGER NOT NULL,
  photo_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, photo_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  photo_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_photos_user_created ON photos(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_photo_created ON comments(photo_id, created_at ASC);
`);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      styleSrc: ["'self'"],
      scriptSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginResourcePolicy: { policy: "same-origin" }
}));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));

const SQLiteStore = SQLiteStoreFactory(session);
app.use(session({
  store: new SQLiteStore({ dir: dataDir, db: "sessions.db" }),
  name: sessionCookieName,
  secret: SESSION_SECRET || crypto.randomBytes(48).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8,
    path: "/"
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
  res.locals.error = null;
  res.locals.notice = null;
  res.locals.csrfToken = "";
  next();
});
app.use(csrfProtection);
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }
});

const allowedTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"]
]);

function cleanText(value, maxLength) {
  return sanitizeHtml(String(value || ""), {
    allowedTags: [],
    allowedAttributes: {}
  }).trim().slice(0, maxLength);
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function validationFailure(req, res, view, status = 400, extra = {}) {
  const firstError = validationResult(req).array()[0];
  return res.status(status).render(view, {
    ...extra,
    error: firstError ? firstError.msg : "Invalid request."
  });
}

function getPhotoWithOwner(photoId) {
  return db.prepare(`
    SELECT p.*, u.username
    FROM photos p
    JOIN users u ON u.id = p.user_id
    WHERE p.id = ?
  `).get(photoId);
}

function listPhotos(whereSql, params) {
  return db.prepare(`
    SELECT p.id, p.caption, p.stored_name, p.mime_type, p.created_at,
           u.id AS user_id, u.username,
           COUNT(DISTINCT l.user_id) AS like_count,
           EXISTS(SELECT 1 FROM likes ml WHERE ml.photo_id = p.id AND ml.user_id = ?) AS liked_by_me
    FROM photos p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN likes l ON l.photo_id = p.id
    ${whereSql}
    GROUP BY p.id
    ORDER BY p.created_at DESC
    LIMIT 50
  `).all(params);
}

app.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  res.redirect("/feed");
});

app.get("/register", (req, res) => res.render("register"));

app.post("/register", authLimiter, [
  body("username").trim().isLength({ min: 3, max: 24 }).matches(/^[a-zA-Z0-9_]+$/)
    .withMessage("Username must be 3-24 letters, numbers, or underscores."),
  body("password").isLength({ min: 12, max: 128 })
    .withMessage("Password must be at least 12 characters.")
], async (req, res, next) => {
  if (!validationResult(req).isEmpty()) return validationFailure(req, res, "register");
  try {
    const username = req.body.username.trim();
    const passwordHash = await bcrypt.hash(req.body.password, 12);
    const result = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, passwordHash);
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: result.lastInsertRowid, username };
      res.redirect("/feed");
    });
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).render("register", { error: "That username is already taken." });
    }
    next(err);
  }
});

app.get("/login", (req, res) => res.render("login"));

app.post("/login", authLimiter, [
  body("username").trim().isLength({ min: 1, max: 24 }),
  body("password").isLength({ min: 1, max: 128 })
], async (req, res, next) => {
  if (!validationResult(req).isEmpty()) return validationFailure(req, res, "login");
  try {
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(req.body.username.trim());
    if (!user || !(await bcrypt.compare(req.body.password, user.password_hash))) {
      return res.status(401).render("login", { error: "Invalid username or password." });
    }
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: user.id, username: user.username };
      res.redirect("/feed");
    });
  } catch (err) {
    next(err);
  }
});

app.post("/logout", requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
      res.clearCookie(sessionCookieName, { path: "/" });
    res.redirect("/login");
  });
});

app.get("/feed", requireAuth, (req, res) => {
  const photos = listPhotos(`
    WHERE p.user_id = ?
       OR p.user_id IN (SELECT followed_id FROM follows WHERE follower_id = ?)
  `, [req.session.user.id, req.session.user.id, req.session.user.id]);
  const comments = db.prepare(`
    SELECT c.photo_id, c.body, c.created_at, u.username
    FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.photo_id IN (${photos.map(() => "?").join(",") || "NULL"})
    ORDER BY c.created_at ASC
  `).all(photos.map((p) => p.id));
  res.render("feed", { photos, comments });
});

app.get("/explore", requireAuth, (req, res) => {
  const photos = listPhotos("WHERE 1 = 1", [req.session.user.id]);
  const users = db.prepare(`
    SELECT id, username,
           EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.followed_id = users.id) AS followed
    FROM users
    WHERE id <> ?
    ORDER BY username COLLATE NOCASE ASC
    LIMIT 100
  `).all(req.session.user.id, req.session.user.id);
  res.render("explore", { photos, users });
});

app.get("/upload", requireAuth, (req, res) => res.render("upload"));

app.post("/photos", requireAuth, upload.single("photo"), [
  body("caption").optional({ values: "falsy" }).isLength({ max: 240 }).withMessage("Caption is too long.")
], async (req, res, next) => {
  if (!validationResult(req).isEmpty()) return validationFailure(req, res, "upload");
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).render("upload", { error: "Choose a photo to upload." });
    }
    const detected = await FileType.fromBuffer(req.file.buffer);
    if (!detected || !allowedTypes.has(detected.mime)) {
      return res.status(400).render("upload", { error: "Only JPEG, PNG, and WebP images are accepted." });
    }
    const storedName = `${crypto.randomUUID()}${allowedTypes.get(detected.mime)}`;
    const destination = path.join(uploadDir, storedName);
    const resolved = path.resolve(destination);
    if (!resolved.startsWith(path.resolve(uploadDir) + path.sep)) {
      return res.status(400).render("upload", { error: "Invalid upload path." });
    }
    fs.writeFileSync(resolved, req.file.buffer, { flag: "wx", mode: 0o600 });
    db.prepare("INSERT INTO photos (user_id, stored_name, mime_type, caption) VALUES (?, ?, ?, ?)")
      .run(req.session.user.id, storedName, detected.mime, cleanText(req.body.caption, 240));
    res.redirect("/feed");
  } catch (err) {
    next(err);
  }
});

app.get("/media/:name", requireAuth, [
  param("name").matches(/^[0-9a-fA-F-]{36}\.(jpg|png|webp)$/)
], (req, res, next) => {
  if (!validationResult(req).isEmpty()) return res.status(404).send("Not found");
  const photo = db.prepare("SELECT stored_name, mime_type FROM photos WHERE stored_name = ?").get(req.params.name);
  if (!photo) return res.status(404).send("Not found");
  const fullPath = path.resolve(uploadDir, photo.stored_name);
  if (!fullPath.startsWith(path.resolve(uploadDir) + path.sep)) return res.status(404).send("Not found");
  res.type(photo.mime_type || mime.lookup(fullPath) || "application/octet-stream");
  res.sendFile(fullPath, (err) => {
    if (err) next(err);
  });
});

app.post("/photos/:id/like", requireAuth, [
  param("id").isInt({ min: 1 })
], (req, res) => {
  if (!validationResult(req).isEmpty()) return res.status(400).send("Invalid request");
  const photo = getPhotoWithOwner(Number(req.params.id));
  if (!photo) return res.status(404).send("Not found");
  const existing = db.prepare("SELECT 1 FROM likes WHERE user_id = ? AND photo_id = ?").get(req.session.user.id, photo.id);
  if (existing) {
    db.prepare("DELETE FROM likes WHERE user_id = ? AND photo_id = ?").run(req.session.user.id, photo.id);
  } else {
    db.prepare("INSERT INTO likes (user_id, photo_id) VALUES (?, ?)").run(req.session.user.id, photo.id);
  }
  res.redirect(req.get("referer") && req.get("referer").startsWith(`${req.protocol}://${req.get("host")}`) ? req.get("referer") : "/feed");
});

app.post("/photos/:id/comments", requireAuth, [
  param("id").isInt({ min: 1 }),
  body("body").trim().isLength({ min: 1, max: 500 }).withMessage("Comment must be 1-500 characters.")
], (req, res) => {
  if (!validationResult(req).isEmpty()) return res.status(400).send("Invalid comment");
  const photo = getPhotoWithOwner(Number(req.params.id));
  if (!photo) return res.status(404).send("Not found");
  db.prepare("INSERT INTO comments (user_id, photo_id, body) VALUES (?, ?, ?)")
    .run(req.session.user.id, photo.id, cleanText(req.body.body, 500));
  res.redirect("/feed");
});

app.post("/photos/:id/delete", requireAuth, [
  param("id").isInt({ min: 1 })
], (req, res, next) => {
  if (!validationResult(req).isEmpty()) return res.status(400).send("Invalid request");
  const photo = getPhotoWithOwner(Number(req.params.id));
  if (!photo) return res.status(404).send("Not found");
  if (photo.user_id !== req.session.user.id) return res.status(403).send("Forbidden");
  try {
    db.prepare("DELETE FROM photos WHERE id = ? AND user_id = ?").run(photo.id, req.session.user.id);
    const fullPath = path.resolve(uploadDir, photo.stored_name);
    if (fullPath.startsWith(path.resolve(uploadDir) + path.sep) && fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
    res.redirect("/feed");
  } catch (err) {
    next(err);
  }
});

app.post("/users/:id/follow", requireAuth, [
  param("id").isInt({ min: 1 })
], (req, res) => {
  if (!validationResult(req).isEmpty()) return res.status(400).send("Invalid request");
  const targetId = Number(req.params.id);
  if (targetId === req.session.user.id) return res.status(400).send("Invalid request");
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(targetId);
  if (!user) return res.status(404).send("Not found");
  db.prepare("INSERT OR IGNORE INTO follows (follower_id, followed_id) VALUES (?, ?)")
    .run(req.session.user.id, targetId);
  res.redirect("/explore");
});

app.post("/users/:id/unfollow", requireAuth, [
  param("id").isInt({ min: 1 })
], (req, res) => {
  if (!validationResult(req).isEmpty()) return res.status(400).send("Invalid request");
  db.prepare("DELETE FROM follows WHERE follower_id = ? AND followed_id = ?")
    .run(req.session.user.id, Number(req.params.id));
  res.redirect("/explore");
});

app.use((req, res) => {
  res.status(404).render("error", { title: "Not found", message: "The page was not found." });
});

app.use((err, req, res, next) => {
  if (err.code === "EBADCSRFTOKEN") {
    return res.status(403).render("error", { title: "Forbidden", message: "The form expired. Please try again." });
  }
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).render("error", { title: "Upload too large", message: "Photos must be 5 MB or smaller." });
  }
  console.error(err);
  res.status(500).render("error", { title: "Server error", message: "Something went wrong." });
});

app.listen(PORT, () => {
  console.log(`Photo Share listening on port ${PORT}`);
});
