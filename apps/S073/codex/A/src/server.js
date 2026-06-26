const path = require("path");
const bcrypt = require("bcryptjs");
const express = require("express");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const methodOverride = require("method-override");
const multer = require("multer");
const { randomUUID } = require("crypto");
const { db, dataDir, uploadDir } = require("./db");

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);
const PORT = Number(process.env.PORT || 5073);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    cb(null, `${Date.now()}-${randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      cb(new Error("Only image uploads are allowed."));
      return;
    }
    cb(null, true);
  }
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: false }));
app.use(methodOverride("_method"));
app.use("/uploads", express.static(uploadDir));
app.use("/public", express.static(path.join(__dirname, "public")));
app.use(
  session({
    store: new SQLiteStore({ db: "sessions.db", dir: dataDir }),
    secret: process.env.SESSION_SECRET || "change-this-secret-for-local-dev",
    resave: false,
    saveUninitialized: false,
    cookie: { sameSite: "lax", maxAge: 1000 * 60 * 60 * 24 * 14 }
  })
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

function flash(req, type, message) {
  req.session.flash = { type, message };
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    flash(req, "error", "Please sign in first.");
    return res.redirect("/login");
  }
  return next();
}

function photoQuery(whereClause, currentUserId) {
  return `
    SELECT
      photos.*,
      users.username,
      COUNT(DISTINCT likes.user_id) AS like_count,
      COUNT(DISTINCT comments.id) AS comment_count,
      MAX(CASE WHEN likes.user_id = ${Number(currentUserId || 0)} THEN 1 ELSE 0 END) AS liked_by_me
    FROM photos
    JOIN users ON users.id = photos.user_id
    LEFT JOIN likes ON likes.photo_id = photos.id
    LEFT JOIN comments ON comments.photo_id = photos.id
    ${whereClause}
    GROUP BY photos.id
    ORDER BY photos.created_at DESC
  `;
}

function getComments(photoIds) {
  if (!photoIds.length) return new Map();
  const placeholders = photoIds.map(() => "?").join(",");
  const rows = db
    .prepare(`
      SELECT comments.*, users.username
      FROM comments
      JOIN users ON users.id = comments.user_id
      WHERE comments.photo_id IN (${placeholders})
      ORDER BY comments.created_at ASC
    `)
    .all(...photoIds);

  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.photo_id)) grouped.set(row.photo_id, []);
    grouped.get(row.photo_id).push(row);
  }
  return grouped;
}

function renderPhotos(req, res, view, title, photos, extra = {}) {
  const commentsByPhoto = getComments(photos.map((photo) => photo.id));
  res.render(view, { title, photos, commentsByPhoto, ...extra });
}

app.get("/", (req, res) => {
  if (req.session.user) return res.redirect("/feed");
  const photos = db.prepare(photoQuery("", 0) + " LIMIT 12").all();
  return renderPhotos(req, res, "index", "Discover", photos);
});

app.get("/register", (req, res) => res.render("register", { title: "Register" }));

app.post("/register", async (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    flash(req, "error", "Usernames must be 3-24 characters using letters, numbers, or underscores.");
    return res.redirect("/register");
  }
  if (password.length < 6) {
    flash(req, "error", "Passwords must be at least 6 characters.");
    return res.redirect("/register");
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, hash);
    req.session.user = { id: result.lastInsertRowid, username };
    return res.redirect("/feed");
  } catch (error) {
    flash(req, "error", "That username is already taken.");
    return res.redirect("/register");
  }
});

app.get("/login", (req, res) => res.render("login", { title: "Login" }));

app.post("/login", async (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    flash(req, "error", "Invalid username or password.");
    return res.redirect("/login");
  }

  req.session.user = { id: user.id, username: user.username };
  return res.redirect("/feed");
});

app.post("/logout", requireAuth, (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

app.get("/feed", requireAuth, (req, res) => {
  const photos = db
    .prepare(
      photoQuery(
        `WHERE photos.user_id = ?
         OR photos.user_id IN (SELECT followed_id FROM follows WHERE follower_id = ?)`,
        req.session.user.id
      ) + " LIMIT 50"
    )
    .all(req.session.user.id, req.session.user.id);
  renderPhotos(req, res, "feed", "Feed", photos);
});

app.get("/explore", (req, res) => {
  const photos = db.prepare(photoQuery("", req.session.user?.id || 0) + " LIMIT 50").all();
  renderPhotos(req, res, "feed", "Explore", photos);
});

app.get("/upload", requireAuth, (req, res) => res.render("upload", { title: "Upload" }));

app.post("/photos", requireAuth, upload.single("photo"), (req, res) => {
  if (!req.file) {
    flash(req, "error", "Choose an image to upload.");
    return res.redirect("/upload");
  }

  db.prepare("INSERT INTO photos (user_id, filename, original_name, caption) VALUES (?, ?, ?, ?)").run(
    req.session.user.id,
    req.file.filename,
    req.file.originalname,
    String(req.body.caption || "").trim().slice(0, 500)
  );
  flash(req, "success", "Photo uploaded.");
  return res.redirect("/feed");
});

app.get("/users", requireAuth, (req, res) => {
  const users = db
    .prepare(`
      SELECT users.id, users.username, users.bio,
        CASE WHEN follows.followed_id IS NULL THEN 0 ELSE 1 END AS is_following,
        (SELECT COUNT(*) FROM photos WHERE photos.user_id = users.id) AS photo_count
      FROM users
      LEFT JOIN follows ON follows.followed_id = users.id AND follows.follower_id = ?
      WHERE users.id <> ?
      ORDER BY users.username ASC
    `)
    .all(req.session.user.id, req.session.user.id);
  res.render("users", { title: "People", users });
});

app.get("/users/:username", (req, res) => {
  const user = db.prepare("SELECT id, username, bio, created_at FROM users WHERE username = ?").get(req.params.username);
  if (!user) return res.status(404).render("error", { title: "Not found", message: "User not found." });

  const isFollowing = req.session.user
    ? Boolean(
        db
          .prepare("SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?")
          .get(req.session.user.id, user.id)
      )
    : false;
  const photos = db.prepare(photoQuery("WHERE photos.user_id = ?", req.session.user?.id || 0)).all(user.id);
  renderPhotos(req, res, "profile", `${user.username}'s Photos`, photos, { profileUser: user, isFollowing });
});

app.post("/users/:id/follow", requireAuth, (req, res) => {
  const followedId = Number(req.params.id);
  if (followedId !== req.session.user.id) {
    db.prepare("INSERT OR IGNORE INTO follows (follower_id, followed_id) VALUES (?, ?)").run(req.session.user.id, followedId);
  }
  return res.redirect(req.get("referer") || "/users");
});

app.delete("/users/:id/follow", requireAuth, (req, res) => {
  db.prepare("DELETE FROM follows WHERE follower_id = ? AND followed_id = ?").run(req.session.user.id, Number(req.params.id));
  return res.redirect(req.get("referer") || "/users");
});

app.post("/photos/:id/like", requireAuth, (req, res) => {
  db.prepare("INSERT OR IGNORE INTO likes (user_id, photo_id) VALUES (?, ?)").run(req.session.user.id, Number(req.params.id));
  return res.redirect(req.get("referer") || "/feed");
});

app.delete("/photos/:id/like", requireAuth, (req, res) => {
  db.prepare("DELETE FROM likes WHERE user_id = ? AND photo_id = ?").run(req.session.user.id, Number(req.params.id));
  return res.redirect(req.get("referer") || "/feed");
});

app.post("/photos/:id/comments", requireAuth, (req, res) => {
  const body = String(req.body.body || "").trim().slice(0, 300);
  if (body) {
    db.prepare("INSERT INTO comments (user_id, photo_id, body) VALUES (?, ?, ?)").run(req.session.user.id, Number(req.params.id), body);
  }
  return res.redirect(req.get("referer") || "/feed");
});

app.use((error, req, res, _next) => {
  if (error instanceof multer.MulterError || error.message === "Only image uploads are allowed.") {
    flash(req, "error", error.message);
    return res.redirect("/upload");
  }
  return res.status(500).render("error", { title: "Server error", message: "Something went wrong." });
});

app.use((_req, res) => {
  res.status(404).render("error", { title: "Not found", message: "Page not found." });
});

app.listen(PORT, () => {
  console.log(`Photo Share Express running on http://localhost:${PORT}`);
});
