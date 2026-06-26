require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const helmet = require("helmet");
const csrf = require("csurf");
const rateLimit = require("express-rate-limit");
const { body, param, validationResult } = require("express-validator");

const app = express();
const PORT = Number(process.env.PORT || 5075);
const SESSION_SECRET = process.env.SESSION_SECRET;
const DB_FILE = process.env.DATABASE_FILE || path.join(__dirname, "quiz.sqlite");
const COOKIE_SECURE = process.env.SESSION_COOKIE_SECURE === "true";
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must be set to at least 32 characters.");
}

const db = new sqlite3.Database(DB_FILE);
db.serialize(() => {
  db.run("PRAGMA foreign_keys = ON");
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('teacher', 'student')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS quizzes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id INTEGER NOT NULL,
      prompt TEXT NOT NULL,
      position INTEGER NOT NULL,
      FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL,
      option_text TEXT NOT NULL,
      is_correct INTEGER NOT NULL DEFAULT 0 CHECK(is_correct IN (0, 1)),
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      score INTEGER NOT NULL,
      total INTEGER NOT NULL,
      submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

const SQLiteStore = SQLiteStoreFactory(session);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"]
    }
  }
}));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h", etag: true }));
app.use(session({
  name: "quiz.sid",
  store: new SQLiteStore({ db: "sessions.sqlite", dir: __dirname }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "strict",
    maxAge: 1000 * 60 * 60 * 4
  }
}));

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.errors = [];
  res.locals.values = {};
  next();
});

const csrfProtection = csrf();
app.use(csrfProtection);
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  next();
});

function collectErrors(req) {
  return validationResult(req).array().map((error) => error.msg);
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  return next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect("/login");
    if (req.session.user.role !== role) return res.status(403).render("error", { message: "You are not allowed to access this page." });
    return next();
  };
}

function newCsrfToken(req) {
  return req.csrfToken();
}

function renderValidation(res, req, view, values = {}) {
  res.locals.csrfToken = newCsrfToken(req);
  return res.status(400).render(view, { errors: collectErrors(req), values });
}

function normalizeText(value) {
  return String(value || "").trim();
}

app.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  return res.redirect(req.session.user.role === "teacher" ? "/teacher/quizzes" : "/student/quizzes");
});

app.get("/register", (req, res) => res.render("register", { values: {} }));

app.post("/register",
  body("username").trim().isLength({ min: 3, max: 40 }).matches(/^[a-zA-Z0-9_.-]+$/).withMessage("Username must be 3-40 characters and use letters, numbers, dot, dash, or underscore."),
  body("password").isLength({ min: 10, max: 128 }).withMessage("Password must be at least 10 characters."),
  body("role").isIn(["teacher", "student"]).withMessage("Choose a valid role."),
  async (req, res, next) => {
    if (!validationResult(req).isEmpty()) return renderValidation(res, req, "register", req.body);
    try {
      const passwordHash = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);
      await run("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)", [req.body.username, passwordHash, req.body.role]);
      return res.redirect("/login");
    } catch (err) {
      if (err.message && err.message.includes("UNIQUE")) {
        res.locals.csrfToken = newCsrfToken(req);
        return res.status(409).render("register", { errors: ["That username is already taken."], values: req.body });
      }
      return next(err);
    }
  }
);

app.get("/login", (req, res) => res.render("login", { values: {} }));

app.post("/login",
  body("username").trim().isLength({ min: 1, max: 40 }).withMessage("Enter your username."),
  body("password").isLength({ min: 1, max: 128 }).withMessage("Enter your password."),
  async (req, res, next) => {
    if (!validationResult(req).isEmpty()) return renderValidation(res, req, "login", req.body);
    try {
      const user = await get("SELECT id, username, password_hash, role FROM users WHERE username = ?", [req.body.username]);
      const ok = user ? await bcrypt.compare(req.body.password, user.password_hash) : false;
      if (!ok) {
        await bcrypt.hash(crypto.randomBytes(16).toString("hex"), BCRYPT_ROUNDS);
        res.locals.csrfToken = newCsrfToken(req);
        return res.status(401).render("login", { errors: ["Invalid username or password."], values: { username: req.body.username } });
      }
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.user = { id: user.id, username: user.username, role: user.role };
        return res.redirect(user.role === "teacher" ? "/teacher/quizzes" : "/student/quizzes");
      });
    } catch (err) {
      next(err);
    }
  }
);

app.post("/logout", requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("quiz.sid", { httpOnly: true, secure: COOKIE_SECURE, sameSite: "strict" });
    return res.redirect("/login");
  });
});

app.get("/teacher/quizzes", requireRole("teacher"), async (req, res, next) => {
  try {
    const quizzes = await all(`
      SELECT q.id, q.title, q.description, q.created_at, COUNT(questions.id) AS question_count
      FROM quizzes q
      LEFT JOIN questions ON questions.quiz_id = q.id
      WHERE q.teacher_id = ?
      GROUP BY q.id
      ORDER BY q.created_at DESC
    `, [req.session.user.id]);
    res.render("teacher_quizzes", { quizzes });
  } catch (err) {
    next(err);
  }
});

app.get("/teacher/quizzes/new", requireRole("teacher"), (req, res) => res.render("quiz_new", { values: {} }));

app.post("/teacher/quizzes",
  requireRole("teacher"),
  body("title").trim().isLength({ min: 3, max: 120 }).withMessage("Quiz title must be 3-120 characters."),
  body("description").optional({ checkFalsy: true }).trim().isLength({ max: 500 }).withMessage("Description must be 500 characters or fewer."),
  body("question_prompt").custom((prompts) => Array.isArray(prompts) && prompts.some((p) => normalizeText(p).length >= 3)).withMessage("Add at least one question."),
  async (req, res, next) => {
    const prompts = Array.isArray(req.body.question_prompt) ? req.body.question_prompt : [req.body.question_prompt];
    const optionTexts = [0, 1, 2, 3].map((i) => Array.isArray(req.body[`option_${i}`]) ? req.body[`option_${i}`] : [req.body[`option_${i}`]]);
    const correctAnswers = Array.isArray(req.body.correct_answer) ? req.body.correct_answer : [req.body.correct_answer];
    const questions = [];

    prompts.forEach((prompt, index) => {
      const cleanedPrompt = normalizeText(prompt);
      const cleanedOptions = optionTexts.map((list) => normalizeText(list[index]));
      const correct = Number(correctAnswers[index]);
      if (!cleanedPrompt && cleanedOptions.every((option) => !option)) return;
      questions.push({ prompt: cleanedPrompt, options: cleanedOptions, correct });
    });

    const formErrors = collectErrors(req);
    if (questions.length > 20) formErrors.push("A quiz can contain at most 20 questions.");
    questions.forEach((question, index) => {
      if (question.prompt.length < 3 || question.prompt.length > 500) formErrors.push(`Question ${index + 1} must be 3-500 characters.`);
      question.options.forEach((option, optionIndex) => {
        if (option.length < 1 || option.length > 250) formErrors.push(`Question ${index + 1}, option ${optionIndex + 1} must be 1-250 characters.`);
      });
      if (!Number.isInteger(question.correct) || question.correct < 0 || question.correct > 3) formErrors.push(`Choose a valid correct answer for question ${index + 1}.`);
    });

    if (formErrors.length > 0) {
      res.locals.csrfToken = newCsrfToken(req);
      return res.status(400).render("quiz_new", { errors: formErrors, values: req.body });
    }

    try {
      await run("BEGIN TRANSACTION");
      const quiz = await run("INSERT INTO quizzes (teacher_id, title, description) VALUES (?, ?, ?)", [
        req.session.user.id,
        normalizeText(req.body.title),
        normalizeText(req.body.description)
      ]);
      for (let i = 0; i < questions.length; i += 1) {
        const question = questions[i];
        const questionRow = await run("INSERT INTO questions (quiz_id, prompt, position) VALUES (?, ?, ?)", [quiz.lastID, question.prompt, i + 1]);
        for (let j = 0; j < question.options.length; j += 1) {
          await run("INSERT INTO options (question_id, option_text, is_correct) VALUES (?, ?, ?)", [questionRow.lastID, question.options[j], question.correct === j ? 1 : 0]);
        }
      }
      await run("COMMIT");
      return res.redirect(`/teacher/quizzes/${quiz.lastID}`);
    } catch (err) {
      await run("ROLLBACK").catch(() => {});
      return next(err);
    }
  }
);

app.get("/teacher/quizzes/:id",
  requireRole("teacher"),
  param("id").isInt({ min: 1 }).withMessage("Invalid quiz id."),
  async (req, res, next) => {
    if (!validationResult(req).isEmpty()) return res.status(404).render("error", { message: "Quiz not found." });
    try {
      const quiz = await get("SELECT id, title, description FROM quizzes WHERE id = ? AND teacher_id = ?", [req.params.id, req.session.user.id]);
      if (!quiz) return res.status(404).render("error", { message: "Quiz not found." });
      const questions = await all(`
        SELECT questions.id, questions.prompt, options.option_text, options.is_correct
        FROM questions
        JOIN options ON options.question_id = questions.id
        WHERE questions.quiz_id = ?
        ORDER BY questions.position, options.id
      `, [quiz.id]);
      const attempts = await all(`
        SELECT attempts.score, attempts.total, attempts.submitted_at, users.username
        FROM attempts
        JOIN users ON users.id = attempts.student_id
        WHERE attempts.quiz_id = ?
        ORDER BY attempts.submitted_at DESC
      `, [quiz.id]);
      res.render("teacher_quiz_detail", { quiz, questions, attempts });
    } catch (err) {
      next(err);
    }
  }
);

app.get("/student/quizzes", requireRole("student"), async (req, res, next) => {
  try {
    const quizzes = await all(`
      SELECT q.id, q.title, q.description, u.username AS teacher_name, COUNT(questions.id) AS question_count
      FROM quizzes q
      JOIN users u ON u.id = q.teacher_id
      JOIN questions ON questions.quiz_id = q.id
      GROUP BY q.id
      ORDER BY q.created_at DESC
    `);
    const attempts = await all("SELECT quiz_id, score, total, submitted_at FROM attempts WHERE student_id = ? ORDER BY submitted_at DESC", [req.session.user.id]);
    res.render("student_quizzes", { quizzes, attempts });
  } catch (err) {
    next(err);
  }
});

app.get("/student/quizzes/:id",
  requireRole("student"),
  param("id").isInt({ min: 1 }).withMessage("Invalid quiz id."),
  async (req, res, next) => {
    if (!validationResult(req).isEmpty()) return res.status(404).render("error", { message: "Quiz not found." });
    try {
      const quiz = await get("SELECT id, title, description FROM quizzes WHERE id = ?", [req.params.id]);
      if (!quiz) return res.status(404).render("error", { message: "Quiz not found." });
      const rows = await all(`
        SELECT questions.id AS question_id, questions.prompt, options.id AS option_id, options.option_text
        FROM questions
        JOIN options ON options.question_id = questions.id
        WHERE questions.quiz_id = ?
        ORDER BY questions.position, options.id
      `, [quiz.id]);
      if (rows.length === 0) return res.status(404).render("error", { message: "Quiz not found." });
      const questions = groupQuestions(rows);
      res.render("take_quiz", { quiz, questions });
    } catch (err) {
      next(err);
    }
  }
);

app.post("/student/quizzes/:id/submit",
  requireRole("student"),
  param("id").isInt({ min: 1 }).withMessage("Invalid quiz id."),
  async (req, res, next) => {
    if (!validationResult(req).isEmpty()) return res.status(404).render("error", { message: "Quiz not found." });
    try {
      const quiz = await get("SELECT id, title FROM quizzes WHERE id = ?", [req.params.id]);
      if (!quiz) return res.status(404).render("error", { message: "Quiz not found." });

      const rows = await all(`
        SELECT questions.id AS question_id, options.id AS option_id, options.is_correct
        FROM questions
        JOIN options ON options.question_id = questions.id
        WHERE questions.quiz_id = ?
        ORDER BY questions.position, options.id
      `, [quiz.id]);
      if (rows.length === 0) return res.status(404).render("error", { message: "Quiz not found." });

      const questionIds = [...new Set(rows.map((row) => row.question_id))];
      let score = 0;
      questionIds.forEach((questionId) => {
        const submitted = Number(req.body[`question_${questionId}`]);
        const selected = rows.find((row) => row.question_id === questionId && row.option_id === submitted);
        if (selected && selected.is_correct === 1) score += 1;
      });
      await run("INSERT INTO attempts (quiz_id, student_id, score, total) VALUES (?, ?, ?, ?)", [quiz.id, req.session.user.id, score, questionIds.length]);
      res.render("score", { quiz, score, total: questionIds.length });
    } catch (err) {
      next(err);
    }
  }
);

function groupQuestions(rows) {
  const map = new Map();
  rows.forEach((row) => {
    if (!map.has(row.question_id)) {
      map.set(row.question_id, { id: row.question_id, prompt: row.prompt, options: [] });
    }
    map.get(row.question_id).options.push({ id: row.option_id, text: row.option_text });
  });
  return Array.from(map.values());
}

app.use((req, res) => {
  res.status(404).render("error", { message: "Page not found." });
});

app.use((err, req, res, next) => {
  if (err.code === "EBADCSRFTOKEN") {
    return res.status(403).render("error", { message: "Your form expired. Go back, refresh, and try again." });
  }
  console.error(err);
  return res.status(500).render("error", { message: "Something went wrong. Please try again later." });
});

app.listen(PORT, () => {
  console.log(`Quiz platform listening on port ${PORT}`);
});
