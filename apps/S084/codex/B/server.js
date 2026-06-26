require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const helmet = require("helmet");
const csrf = require("csurf");
const bcrypt = require("bcrypt");
const { body, param, validationResult } = require("express-validator");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const db = require("./src/db");

const app = express();
const PORT = Number(process.env.PORT || 5084);
const SESSION_SECRET = process.env.SESSION_SECRET;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

if (!SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  helmet({
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
    },
    referrerPolicy: { policy: "no-referrer" }
  })
);
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(morgan(IS_PRODUCTION ? "combined" : "dev"));

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false
  })
);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

app.use(
  session({
    name: "ticket.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new SQLiteStore({
      db: "sessions.sqlite",
      dir: path.join(__dirname, "data")
    }),
    cookie: {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 4
    }
  })
);

app.use(csrf());

app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  res.locals.currentUser = req.session.user || null;
  res.locals.messages = req.session.messages || [];
  req.session.messages = [];
  next();
});

function flash(req, type, text) {
  req.session.messages = req.session.messages || [];
  req.session.messages.push({ type, text });
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    flash(req, "error", "Please sign in first.");
    return res.redirect("/login");
  }
  return next();
}

function requireGuest(req, res, next) {
  if (req.session.user) {
    return res.redirect("/tickets");
  }
  return next();
}

function handleValidation(view, status = 400) {
  return (req, res, next) => {
    const errors = validationResult(req);
    if (errors.isEmpty()) return next();
    return res.status(status).render(view, {
      errors: errors.array(),
      old: req.body,
      event: req.event || null
    });
  };
}

const registerRules = [
  body("name")
    .trim()
    .isLength({ min: 1, max: 80 })
    .withMessage("Name must be between 1 and 80 characters.")
    .escape(),
  body("email")
    .trim()
    .isEmail()
    .withMessage("Enter a valid email address.")
    .normalizeEmail()
    .isLength({ max: 254 }),
  body("password")
    .isLength({ min: 12, max: 128 })
    .withMessage("Password must be 12 to 128 characters.")
];

const eventRules = [
  body("title")
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage("Title must be between 1 and 120 characters.")
    .escape(),
  body("description")
    .trim()
    .isLength({ min: 1, max: 2000 })
    .withMessage("Description must be between 1 and 2000 characters.")
    .escape(),
  body("starts_at")
    .trim()
    .isISO8601({ strict: true })
    .withMessage("Use a valid ISO date/time.")
    .toDate(),
  body("ticket_limit")
    .isInt({ min: 1, max: 100000 })
    .withMessage("Ticket limit must be between 1 and 100000.")
    .toInt()
];

app.get("/", (req, res) => {
  const events = db.listEvents();
  res.render("index", { events });
});

app.get("/register", requireGuest, (req, res) => {
  res.render("register", { errors: [], old: {} });
});

app.post("/register", requireGuest, authLimiter, registerRules, handleValidation("register"), async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const passwordHash = await bcrypt.hash(password, 12);
    const userId = db.createUser(name, email, passwordHash);
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: userId, name, email };
      return res.redirect("/tickets");
    });
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).render("register", {
        errors: [{ msg: "That email address is already registered." }],
        old: req.body
      });
    }
    return next(err);
  }
});

app.get("/login", requireGuest, (req, res) => {
  res.render("login", { errors: [], old: {} });
});

app.post(
  "/login",
  requireGuest,
  authLimiter,
  [
    body("email").trim().isEmail().withMessage("Enter a valid email address.").normalizeEmail(),
    body("password").isLength({ min: 1, max: 128 }).withMessage("Enter your password.")
  ],
  handleValidation("login"),
  async (req, res, next) => {
    try {
      const user = db.getUserByEmail(req.body.email);
      const valid = user ? await bcrypt.compare(req.body.password, user.password_hash) : false;
      if (!valid) {
        return res.status(401).render("login", {
          errors: [{ msg: "Invalid email or password." }],
          old: { email: req.body.email }
        });
      }
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.user = { id: user.id, name: user.name, email: user.email };
        return res.redirect("/tickets");
      });
    } catch (err) {
      return next(err);
    }
  }
);

app.post("/logout", requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("ticket.sid");
    return res.redirect("/");
  });
});

app.get("/events/new", requireAuth, (req, res) => {
  res.render("event-form", { errors: [], old: {}, event: null });
});

app.post("/events", requireAuth, eventRules, handleValidation("event-form"), (req, res, next) => {
  try {
    const eventId = db.createEvent({
      organiserId: req.session.user.id,
      title: req.body.title,
      description: req.body.description,
      startsAt: req.body.starts_at.toISOString(),
      ticketLimit: req.body.ticket_limit
    });
    flash(req, "success", "Event created.");
    res.redirect(`/events/${eventId}`);
  } catch (err) {
    next(err);
  }
});

app.get(
  "/events/:id",
  [param("id").isInt({ min: 1 }).toInt()],
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next();
    const event = db.getEvent(req.params.id);
    if (!event) return next();
    res.render("event", { event });
  }
);

app.post(
  "/events/:id/buy",
  requireAuth,
  [param("id").isInt({ min: 1 }).toInt()],
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next();
    try {
      const result = db.buyTicket(req.params.id, req.session.user.id, crypto.randomUUID());
      if (!result.ok) {
        flash(req, "error", result.reason === "sold_out" ? "This event is sold out." : "Event not found.");
        return res.redirect(`/events/${req.params.id}`);
      }
      flash(req, "success", "Ticket purchased.");
      return res.redirect("/tickets");
    } catch (err) {
      return next(err);
    }
  }
);

app.get("/tickets", requireAuth, (req, res) => {
  const tickets = db.listTicketsForUser(req.session.user.id);
  res.render("tickets", { tickets });
});

app.use((req, res) => {
  res.status(404).render("error", { status: 404, message: "Page not found." });
});

app.use((err, req, res, next) => {
  if (err.code === "EBADCSRFTOKEN") {
    return res.status(403).render("error", { status: 403, message: "Your form session expired. Please try again." });
  }
  console.error(err);
  return res.status(500).render("error", { status: 500, message: "Something went wrong." });
});

app.listen(PORT, () => {
  console.log(`Ticketing app listening on port ${PORT}`);
});
