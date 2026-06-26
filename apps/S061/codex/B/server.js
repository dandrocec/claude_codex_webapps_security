require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const csrf = require("csurf");
const bcrypt = require("bcrypt");
const Database = require("better-sqlite3");
const { body, param, validationResult } = require("express-validator");

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);
const PORT = Number.parseInt(process.env.PORT || "5061", 10);
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must be set to at least 32 characters.");
}

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, "data.sqlite");
const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('instructor', 'student')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instructor_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (instructor_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS enrollments (
  user_id INTEGER NOT NULL,
  course_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, course_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lesson_completions (
  user_id INTEGER NOT NULL,
  lesson_id INTEGER NOT NULL,
  completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, lesson_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
);
`);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'"],
      "img-src": ["'self'", "data:"],
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
      "form-action": ["'self'"],
      "frame-ancestors": ["'none'"]
    }
  },
  referrerPolicy: { policy: "no-referrer" }
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false
}));

app.use(express.urlencoded({ extended: false, limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public"), {
  etag: true,
  maxAge: "1h",
  index: false
}));

const localDevCookieOverride = process.env.COOKIE_SECURE === "false";
app.use(session({
  name: "elearn.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  store: new SQLiteStore({ db: "sessions.sqlite", dir: __dirname }),
  cookie: {
    httpOnly: true,
    secure: !localDevCookieOverride,
    sameSite: "lax",
    path: "/",
    maxAge: 1000 * 60 * 60 * 2
  }
}));

app.use(csrf());

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.csrfToken = req.csrfToken();
  res.locals.errors = [];
  res.locals.form = {};
  next();
});

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function validationMiddleware(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  req.validationErrors = result.array().map((error) => error.msg);
  return next();
}

function renderWithErrors(res, view, status, errors, form = {}, locals = {}) {
  return res.status(status).render(view, { ...locals, errors, form });
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  return next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect("/login");
    if (req.session.user.role !== role) return res.status(403).render("error", { message: "Forbidden" });
    return next();
  };
}

function getCourse(courseId) {
  return db.prepare(`
    SELECT c.*, u.name AS instructor_name
    FROM courses c
    JOIN users u ON u.id = c.instructor_id
    WHERE c.id = ?
  `).get(courseId);
}

function ownsCourse(userId, courseId) {
  const row = db.prepare("SELECT 1 FROM courses WHERE id = ? AND instructor_id = ?").get(courseId, userId);
  return Boolean(row);
}

function isEnrolled(userId, courseId) {
  const row = db.prepare("SELECT 1 FROM enrollments WHERE user_id = ? AND course_id = ?").get(userId, courseId);
  return Boolean(row);
}

function canViewCourseContent(user, course) {
  if (!user || !course) return false;
  return user.role === "instructor" ? course.instructor_id === user.id : isEnrolled(user.id, course.id);
}

function courseListFor(user) {
  if (!user) {
    return db.prepare(`
      SELECT c.id, c.title, c.description, u.name AS instructor_name, 0 AS enrolled, 0 AS owned
      FROM courses c
      JOIN users u ON u.id = c.instructor_id
      ORDER BY c.created_at DESC
    `).all();
  }

  return db.prepare(`
    SELECT c.id, c.title, c.description, u.name AS instructor_name,
      CASE WHEN e.user_id IS NULL THEN 0 ELSE 1 END AS enrolled,
      CASE WHEN c.instructor_id = ? THEN 1 ELSE 0 END AS owned
    FROM courses c
    JOIN users u ON u.id = c.instructor_id
    LEFT JOIN enrollments e ON e.course_id = c.id AND e.user_id = ?
    ORDER BY c.created_at DESC
  `).all(user.id, user.id);
}

const idParam = param("id").isInt({ min: 1 }).withMessage("Invalid resource id.").toInt();

app.get("/", (req, res) => {
  res.render("index", { courses: courseListFor(req.session.user) });
});

app.get("/register", (req, res) => {
  res.render("register", { form: {} });
});

app.post("/register",
  body("name").trim().customSanitizer(normalizeText).isLength({ min: 2, max: 80 }).withMessage("Name must be 2 to 80 characters."),
  body("email").trim().isEmail().withMessage("Enter a valid email.").normalizeEmail().isLength({ max: 254 }),
  body("password").isStrongPassword({ minLength: 12, minLowercase: 1, minUppercase: 1, minNumbers: 1, minSymbols: 1 }).withMessage("Password must be at least 12 characters and include upper, lower, number, and symbol."),
  body("role").isIn(["instructor", "student"]).withMessage("Choose a valid role."),
  validationMiddleware,
  async (req, res, next) => {
    const form = {
      name: normalizeText(req.body.name),
      email: normalizeText(req.body.email).toLowerCase(),
      role: req.body.role
    };
    if (req.validationErrors) return renderWithErrors(res, "register", 400, req.validationErrors, form);

    try {
      const passwordHash = await bcrypt.hash(req.body.password, 12);
      const result = db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)")
        .run(form.name, form.email, passwordHash, form.role);
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.user = { id: result.lastInsertRowid, name: form.name, email: form.email, role: form.role };
        return res.redirect("/");
      });
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return renderWithErrors(res, "register", 409, ["Email is already registered."], form);
      }
      return next(error);
    }
  }
);

app.get("/login", (req, res) => {
  res.render("login", { form: {} });
});

app.post("/login",
  body("email").trim().isEmail().withMessage("Enter a valid email.").normalizeEmail(),
  body("password").isLength({ min: 1, max: 256 }).withMessage("Password is required."),
  validationMiddleware,
  async (req, res, next) => {
    const form = { email: normalizeText(req.body.email).toLowerCase() };
    if (req.validationErrors) return renderWithErrors(res, "login", 400, req.validationErrors, form);

    try {
      const user = db.prepare("SELECT * FROM users WHERE email = ?").get(form.email);
      const ok = user ? await bcrypt.compare(req.body.password, user.password_hash) : false;
      if (!ok) return renderWithErrors(res, "login", 401, ["Invalid email or password."], form);

      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
        return res.redirect("/");
      });
    } catch (error) {
      return next(error);
    }
  }
);

app.post("/logout", requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("elearn.sid", { path: "/" });
    return res.redirect("/");
  });
});

app.get("/courses/new", requireRole("instructor"), (req, res) => {
  res.render("course-form", { form: {}, action: "/courses", title: "Create course" });
});

app.post("/courses",
  requireRole("instructor"),
  body("title").trim().customSanitizer(normalizeText).isLength({ min: 3, max: 120 }).withMessage("Title must be 3 to 120 characters."),
  body("description").trim().customSanitizer(normalizeText).isLength({ min: 10, max: 1000 }).withMessage("Description must be 10 to 1000 characters."),
  validationMiddleware,
  (req, res, next) => {
    const form = { title: normalizeText(req.body.title), description: normalizeText(req.body.description) };
    if (req.validationErrors) return renderWithErrors(res, "course-form", 400, req.validationErrors, form, { action: "/courses", title: "Create course" });

    try {
      const result = db.prepare("INSERT INTO courses (instructor_id, title, description) VALUES (?, ?, ?)")
        .run(req.session.user.id, form.title, form.description);
      return res.redirect(`/courses/${result.lastInsertRowid}`);
    } catch (error) {
      return next(error);
    }
  }
);

app.get("/courses/:id",
  idParam,
  validationMiddleware,
  (req, res, next) => {
    if (req.validationErrors) return res.status(404).render("error", { message: "Course not found" });
    try {
      const course = getCourse(req.params.id);
      if (!course) return res.status(404).render("error", { message: "Course not found" });

      const user = req.session.user || null;
      const canView = canViewCourseContent(user, course);
      const lessons = canView
        ? db.prepare(`
            SELECT l.*,
              CASE WHEN lc.user_id IS NULL THEN 0 ELSE 1 END AS completed
            FROM lessons l
            LEFT JOIN lesson_completions lc ON lc.lesson_id = l.id AND lc.user_id = ?
            WHERE l.course_id = ?
            ORDER BY l.position ASC, l.id ASC
          `).all(user.id, course.id)
        : [];

      res.render("course", {
        course,
        lessons,
        canView,
        enrolled: user ? isEnrolled(user.id, course.id) : false,
        owned: user ? course.instructor_id === user.id : false
      });
    } catch (error) {
      return next(error);
    }
  }
);

app.post("/courses/:id/enroll",
  requireRole("student"),
  idParam,
  validationMiddleware,
  (req, res, next) => {
    if (req.validationErrors) return res.status(404).render("error", { message: "Course not found" });
    try {
      const course = getCourse(req.params.id);
      if (!course) return res.status(404).render("error", { message: "Course not found" });
      db.prepare("INSERT OR IGNORE INTO enrollments (user_id, course_id) VALUES (?, ?)")
        .run(req.session.user.id, course.id);
      return res.redirect(`/courses/${course.id}`);
    } catch (error) {
      return next(error);
    }
  }
);

app.get("/courses/:id/lessons/new",
  requireRole("instructor"),
  idParam,
  validationMiddleware,
  (req, res) => {
    if (req.validationErrors || !ownsCourse(req.session.user.id, req.params.id)) {
      return res.status(403).render("error", { message: "Forbidden" });
    }
    res.render("lesson-form", { form: {}, courseId: req.params.id });
  }
);

app.post("/courses/:id/lessons",
  requireRole("instructor"),
  idParam,
  body("title").trim().customSanitizer(normalizeText).isLength({ min: 3, max: 120 }).withMessage("Lesson title must be 3 to 120 characters."),
  body("content").trim().isLength({ min: 10, max: 10000 }).withMessage("Lesson content must be 10 to 10000 characters."),
  validationMiddleware,
  (req, res, next) => {
    const courseId = req.params.id;
    const form = { title: normalizeText(req.body.title), content: String(req.body.content || "").trim() };
    if (req.validationErrors) return renderWithErrors(res, "lesson-form", 400, req.validationErrors, form, { courseId });
    if (!ownsCourse(req.session.user.id, courseId)) return res.status(403).render("error", { message: "Forbidden" });

    try {
      const nextPosition = db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS position FROM lessons WHERE course_id = ?").get(courseId).position;
      db.prepare("INSERT INTO lessons (course_id, title, content, position) VALUES (?, ?, ?, ?)")
        .run(courseId, form.title, form.content, nextPosition);
      return res.redirect(`/courses/${courseId}`);
    } catch (error) {
      return next(error);
    }
  }
);

app.post("/lessons/:id/complete",
  requireRole("student"),
  idParam,
  validationMiddleware,
  (req, res, next) => {
    if (req.validationErrors) return res.status(404).render("error", { message: "Lesson not found" });
    try {
      const lesson = db.prepare("SELECT l.*, c.id AS course_id FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ?").get(req.params.id);
      if (!lesson) return res.status(404).render("error", { message: "Lesson not found" });
      if (!isEnrolled(req.session.user.id, lesson.course_id)) {
        return res.status(403).render("error", { message: "Forbidden" });
      }
      db.prepare("INSERT OR IGNORE INTO lesson_completions (user_id, lesson_id) VALUES (?, ?)")
        .run(req.session.user.id, lesson.id);
      return res.redirect(`/courses/${lesson.course_id}`);
    } catch (error) {
      return next(error);
    }
  }
);

app.use((req, res) => {
  res.status(404).render("error", { message: "Page not found" });
});

app.use((err, req, res, next) => {
  if (err.code === "EBADCSRFTOKEN") {
    return res.status(403).render("error", { message: "Invalid or expired form token." });
  }
  console.error({
    id: crypto.randomUUID(),
    message: err.message,
    stack: process.env.NODE_ENV === "production" ? undefined : err.stack
  });
  return res.status(500).render("error", { message: "Something went wrong." });
});

app.listen(PORT, () => {
  console.log(`E-learning app listening on port ${PORT}`);
});
