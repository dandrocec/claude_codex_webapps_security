require("dotenv").config();

const crypto = require("crypto");
const path = require("path");
const express = require("express");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcrypt");
const { body, param, validationResult } = require("express-validator");
const {
  db,
  initializeDatabase,
  findAdminByEmail,
  findUserById,
  listUsers,
  createUser,
  updateUser,
  setUserActive,
  getStats
} = require("./storage");

const requiredEnv = ["SESSION_SECRET", "ADMIN_EMAIL", "ADMIN_PASSWORD"];
const missingEnv = requiredEnv.filter((name) => !process.env[name]);
if (missingEnv.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnv.join(", ")}`);
}

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);
const isProduction = process.env.NODE_ENV === "production";
const cookieSecure = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === "true"
  : isProduction;
const port = Number(process.env.PORT || 5086);

initializeDatabase({
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD
});

app.disable("x-powered-by");
if (isProduction) {
  app.set("trust proxy", 1);
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'"],
        "img-src": ["'self'", "data:"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"],
        "base-uri": ["'self'"]
      }
    },
    referrerPolicy: { policy: "no-referrer" }
  })
);
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public"), { index: false }));

app.use(
  session({
    name: "sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new SQLiteStore({
      db: "sessions.sqlite",
      dir: path.dirname(process.env.DATABASE_FILE || path.join(__dirname, "..", "data", "app.sqlite"))
    }),
    cookie: {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: "lax",
      maxAge: 1000 * 60 * 30
    }
  })
);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many login attempts. Try again later."
});

app.use((req, res, next) => {
  res.locals.currentAdmin = req.session.admin || null;
  res.locals.csrfToken = req.session.csrfToken || "";
  res.locals.fieldErrors = {};
  res.locals.formData = {};
  next();
});

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }
  return req.session.csrfToken;
}

function requireAdmin(req, res, next) {
  if (!req.session.admin || req.session.admin.role !== "admin") {
    return res.redirect("/login");
  }
  return next();
}

function verifyCsrf(req, res, next) {
  const submitted = req.body._csrf;
  const expected = req.session.csrfToken;
  const valid =
    typeof submitted === "string" &&
    typeof expected === "string" &&
    submitted.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(expected));

  if (!valid) {
    return res.status(403).render("error", {
      title: "Request blocked",
      message: "The form expired or was submitted from an invalid origin."
    });
  }
  return next();
}

function handleValidation(view, status = 400, extra = {}) {
  return (req, res, next) => {
    const result = validationResult(req);
    if (result.isEmpty()) {
      return next();
    }

    const fieldErrors = {};
    for (const error of result.array()) {
      if (!fieldErrors[error.path]) {
        fieldErrors[error.path] = error.msg;
      }
    }

    return res.status(status).render(view, {
      ...extra,
      csrfToken: ensureCsrfToken(req),
      fieldErrors,
      formData: req.body
    });
  };
}

const userValidators = [
  body("name")
    .trim()
    .isLength({ min: 2, max: 80 })
    .withMessage("Name must be between 2 and 80 characters.")
    .matches(/^[\p{L}\p{N} .'-]+$/u)
    .withMessage("Name contains unsupported characters."),
  body("email")
    .trim()
    .isEmail()
    .withMessage("Enter a valid email address.")
    .normalizeEmail()
    .isLength({ max: 254 })
    .withMessage("Email is too long."),
  body("role")
    .isIn(["admin", "user"])
    .withMessage("Choose a valid role.")
];

app.get("/", (req, res) => {
  if (req.session.admin) {
    return res.redirect("/dashboard");
  }
  return res.redirect("/login");
});

app.get("/login", (req, res) => {
  if (req.session.admin) {
    return res.redirect("/dashboard");
  }
  res.render("login", {
    title: "Admin sign in",
    csrfToken: ensureCsrfToken(req),
    error: null
  });
});

app.post(
  "/login",
  loginLimiter,
  verifyCsrf,
  body("email").trim().isEmail().normalizeEmail(),
  body("password").isLength({ min: 1, max: 200 }),
  async (req, res, next) => {
    const invalidResponse = () =>
      res.status(401).render("login", {
        title: "Admin sign in",
        csrfToken: ensureCsrfToken(req),
        error: "Invalid email or password."
      });

    const result = validationResult(req);
    if (!result.isEmpty()) {
      return invalidResponse();
    }

    const admin = findAdminByEmail(req.body.email);
    if (!admin || admin.role !== "admin" || admin.active !== 1) {
      return invalidResponse();
    }

    const passwordOk = await bcrypt.compare(req.body.password, admin.password_hash);
    if (!passwordOk) {
      return invalidResponse();
    }

    req.session.regenerate((err) => {
      if (err) {
        return next(err);
      }
      req.session.admin = {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role
      };
      ensureCsrfToken(req);
      return res.redirect("/dashboard");
    });
  }
);

app.post("/logout", requireAdmin, verifyCsrf, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("sid");
    res.redirect("/login");
  });
});

app.get("/dashboard", requireAdmin, (req, res) => {
  res.render("dashboard", {
    title: "Dashboard",
    csrfToken: ensureCsrfToken(req),
    stats: getStats(),
    users: listUsers()
  });
});

app.get("/users/new", requireAdmin, (req, res) => {
  res.render("user-form", {
    title: "Create user",
    action: "/users",
    submitLabel: "Create user",
    user: null,
    csrfToken: ensureCsrfToken(req),
    fieldErrors: {},
    formData: {}
  });
});

app.post(
  "/users",
  requireAdmin,
  verifyCsrf,
  userValidators,
  body("password")
    .isLength({ min: 12, max: 200 })
    .withMessage("Password must be at least 12 characters."),
  handleValidation("user-form", 400, {
    title: "Create user",
    action: "/users",
    submitLabel: "Create user",
    user: null
  }),
  async (req, res) => {
    const passwordHash = await bcrypt.hash(req.body.password, 12);
    try {
      createUser({
        name: req.body.name,
        email: req.body.email,
        role: req.body.role,
        passwordHash
      });
      res.redirect("/dashboard");
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return res.status(409).render("user-form", {
          title: "Create user",
          action: "/users",
          submitLabel: "Create user",
          user: null,
          csrfToken: ensureCsrfToken(req),
          fieldErrors: { email: "That email is already registered." },
          formData: req.body
        });
      }
      throw error;
    }
  }
);

app.get(
  "/users/:id/edit",
  requireAdmin,
  param("id").isInt({ min: 1 }).toInt(),
  (req, res) => {
    const result = validationResult(req);
    if (!result.isEmpty()) {
      return res.status(404).render("error", { title: "Not found", message: "User not found." });
    }

    const user = findUserById(req.params.id);
    if (!user) {
      return res.status(404).render("error", { title: "Not found", message: "User not found." });
    }

    return res.render("user-form", {
      title: "Edit user",
      action: `/users/${user.id}`,
      submitLabel: "Save changes",
      user,
      csrfToken: ensureCsrfToken(req),
      fieldErrors: {},
      formData: user
    });
  }
);

app.post(
  "/users/:id",
  requireAdmin,
  verifyCsrf,
  param("id").isInt({ min: 1 }).toInt(),
  userValidators,
  body("password")
    .optional({ values: "falsy" })
    .isLength({ min: 12, max: 200 })
    .withMessage("Password must be at least 12 characters."),
  async (req, res, next) => {
    const user = findUserById(req.params.id);
    if (!user) {
      return res.status(404).render("error", { title: "Not found", message: "User not found." });
    }
    if (user.id === req.session.admin.id && req.body.role !== "admin") {
      return res.status(400).render("user-form", {
        title: "Edit user",
        action: `/users/${user.id}`,
        submitLabel: "Save changes",
        user,
        csrfToken: ensureCsrfToken(req),
        fieldErrors: { role: "You cannot remove admin access from the account you are using." },
        formData: req.body
      });
    }

    const result = validationResult(req);
    if (!result.isEmpty()) {
      const fieldErrors = {};
      for (const error of result.array()) {
        if (!fieldErrors[error.path]) {
          fieldErrors[error.path] = error.msg;
        }
      }
      return res.status(400).render("user-form", {
        title: "Edit user",
        action: `/users/${user.id}`,
        submitLabel: "Save changes",
        user,
        csrfToken: ensureCsrfToken(req),
        fieldErrors,
        formData: req.body
      });
    }

    try {
      const passwordHash = req.body.password
        ? await bcrypt.hash(req.body.password, 12)
        : user.password_hash;
      updateUser({
        id: user.id,
        name: req.body.name,
        email: req.body.email,
        role: req.body.role,
        passwordHash
      });
      if (req.session.admin.id === user.id) {
        req.session.admin.email = req.body.email;
        req.session.admin.name = req.body.name;
        req.session.admin.role = req.body.role;
      }
      return res.redirect("/dashboard");
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return res.status(409).render("user-form", {
          title: "Edit user",
          action: `/users/${user.id}`,
          submitLabel: "Save changes",
          user,
          csrfToken: ensureCsrfToken(req),
          fieldErrors: { email: "That email is already registered." },
          formData: req.body
        });
      }
      return next(error);
    }
  }
);

app.post(
  "/users/:id/deactivate",
  requireAdmin,
  verifyCsrf,
  param("id").isInt({ min: 1 }).toInt(),
  (req, res) => {
    const result = validationResult(req);
    if (!result.isEmpty()) {
      return res.status(404).render("error", { title: "Not found", message: "User not found." });
    }

    const user = findUserById(req.params.id);
    if (!user) {
      return res.status(404).render("error", { title: "Not found", message: "User not found." });
    }
    if (user.id === req.session.admin.id) {
      return res.status(400).render("error", {
        title: "Action blocked",
        message: "You cannot deactivate the account you are currently using."
      });
    }

    setUserActive(user.id, false);
    return res.redirect("/dashboard");
  }
);

app.post(
  "/users/:id/activate",
  requireAdmin,
  verifyCsrf,
  param("id").isInt({ min: 1 }).toInt(),
  (req, res) => {
    const result = validationResult(req);
    if (!result.isEmpty()) {
      return res.status(404).render("error", { title: "Not found", message: "User not found." });
    }

    const user = findUserById(req.params.id);
    if (!user) {
      return res.status(404).render("error", { title: "Not found", message: "User not found." });
    }

    setUserActive(user.id, true);
    return res.redirect("/dashboard");
  }
);

app.use((req, res) => {
  res.status(404).render("error", { title: "Not found", message: "Page not found." });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) {
    return next(err);
  }
  return res.status(500).render("error", {
    title: "Server error",
    message: "Something went wrong. Please try again later."
  });
});

process.on("SIGINT", () => {
  db.close();
  process.exit(0);
});

app.listen(port, () => {
  console.log(`Admin dashboard listening on port ${port}`);
});
