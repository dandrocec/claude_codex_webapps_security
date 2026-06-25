require("dotenv").config();

const crypto = require("crypto");
const path = require("path");
const bcrypt = require("bcrypt");
const Database = require("better-sqlite3");
const csrf = require("csurf");
const express = require("express");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const helmet = require("helmet");
const Joi = require("joi");
const { marked } = require("marked");
const sanitizeHtml = require("sanitize-html");

const app = express();
const port = Number.parseInt(process.env.PORT || "5005", 10);
const isProduction = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must be set to at least 32 characters.");
}

const db = new Database(process.env.DATABASE_PATH || path.join(__dirname, "app.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS previews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    markdown TEXT NOT NULL,
    html TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
if (userCount === 0) {
  const demoPassword = process.env.DEMO_PASSWORD || crypto.randomBytes(24).toString("hex");
  const hash = bcrypt.hashSync(demoPassword, 12);
  db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run("demo", hash);
  if (!process.env.DEMO_PASSWORD) {
    console.log("Generated demo password:", demoPassword);
  }
}

marked.setOptions({
  async: false,
  breaks: true,
  gfm: true,
  headerIds: false,
  mangle: false
});

const markdownSchema = Joi.object({
  markdown: Joi.string().trim().max(20000).allow("").required()
});

const loginSchema = Joi.object({
  username: Joi.string().trim().min(1).max(80).pattern(/^[a-zA-Z0-9_.-]+$/).required(),
  password: Joi.string().min(1).max(200).required()
});

const allowedHtml = {
  allowedTags: [
    "a", "abbr", "b", "blockquote", "br", "code", "del", "details", "div", "em",
    "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "kbd", "li", "ol",
    "p", "pre", "s", "span", "strong", "sub", "summary", "sup", "table", "tbody",
    "td", "th", "thead", "tr", "ul"
  ],
  allowedAttributes: {
    a: ["href", "name", "target", "rel"],
    img: ["src", "alt", "title"],
    code: ["class"],
    span: ["class"],
    div: ["class"],
    table: ["class"]
  },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" })
  }
};

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false
}));

app.use(express.urlencoded({ extended: false, limit: "64kb" }));
app.use(express.static(path.join(__dirname, "public"), {
  etag: true,
  maxAge: isProduction ? "1h" : 0
}));

app.use(session({
  name: "md.sid",
  secret: sessionSecret,
  store: new SQLiteStore({
    db: "sessions.sqlite",
    dir: __dirname
  }),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60
  }
}));

app.use(csrf());

app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  res.locals.user = req.session.user || null;
  next();
});

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  return next();
}

function renderMarkdown(markdown) {
  const rawHtml = marked.parse(markdown);
  return sanitizeHtml(rawHtml, allowedHtml);
}

app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/login", async (req, res, next) => {
  try {
    const { value, error } = loginSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      return res.status(400).render("login", { error: "Invalid username or password." });
    }

    const user = db.prepare("SELECT id, username, password_hash FROM users WHERE username = ?").get(value.username);
    const valid = user ? await bcrypt.compare(value.password, user.password_hash) : false;
    if (!valid) {
      return res.status(401).render("login", { error: "Invalid username or password." });
    }

    req.session.regenerate((regenerateError) => {
      if (regenerateError) {
        return next(regenerateError);
      }
      req.session.user = { id: user.id, username: user.username };
      return res.redirect("/");
    });
  } catch (err) {
    next(err);
  }
});

app.post("/logout", requireLogin, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) {
      return next(err);
    }
    res.clearCookie("md.sid");
    return res.redirect("/login");
  });
});

app.get("/", requireLogin, (req, res) => {
  res.render("index", {
    markdown: "",
    renderedHtml: "",
    error: null
  });
});

app.post("/preview", requireLogin, (req, res, next) => {
  try {
    const { value, error } = markdownSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      return res.status(400).render("index", {
        markdown: req.body.markdown || "",
        renderedHtml: "",
        error: "Markdown must be 20,000 characters or fewer."
      });
    }

    const renderedHtml = renderMarkdown(value.markdown);
    db.prepare("INSERT INTO previews (user_id, markdown, html) VALUES (?, ?, ?)")
      .run(req.session.user.id, value.markdown, renderedHtml);

    return res.render("index", {
      markdown: value.markdown,
      renderedHtml,
      error: null
    });
  } catch (err) {
    next(err);
  }
});

app.get("/previews/:id", requireLogin, (req, res, next) => {
  try {
    const previewId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(previewId) || previewId < 1) {
      return res.status(404).render("error", { message: "Preview not found." });
    }

    const preview = db.prepare("SELECT id, markdown, html FROM previews WHERE id = ? AND user_id = ?")
      .get(previewId, req.session.user.id);
    if (!preview) {
      return res.status(404).render("error", { message: "Preview not found." });
    }

    return res.render("index", {
      markdown: preview.markdown,
      renderedHtml: preview.html,
      error: null
    });
  } catch (err) {
    next(err);
  }
});

app.use((req, res) => {
  res.status(404).render("error", { message: "Page not found." });
});

app.use((err, req, res, next) => {
  if (err.code === "EBADCSRFTOKEN") {
    return res.status(403).render("error", { message: "Invalid or expired form token." });
  }

  console.error(err);
  return res.status(500).render("error", { message: "Something went wrong." });
});

app.listen(port, () => {
  console.log(`Markdown preview app listening on port ${port}`);
});
