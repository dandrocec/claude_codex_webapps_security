"use strict";

const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const csrf = require("csurf");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");

const app = express();
const PORT = Number.parseInt(process.env.PORT || "5009", 10);
const SESSION_SECRET = process.env.SESSION_SECRET;
const TRUST_PROXY = process.env.TRUST_PROXY === "true";
const SECURE_COOKIE = process.env.SESSION_COOKIE_SECURE === "true";

if (!SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required.");
}

app.disable("x-powered-by");
app.set("trust proxy", TRUST_PROXY ? 1 : 0);
app.set("view engine", "ejs");
app.set("views", `${__dirname}/views`);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        upgradeInsecureRequests: SECURE_COOKIE ? [] : null
      }
    },
    referrerPolicy: { policy: "no-referrer" }
  })
);

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: "draft-7",
    legacyHeaders: false
  })
);

app.use(express.urlencoded({ extended: false, limit: "10kb" }));
app.use(express.static(`${__dirname}/public`, { index: false }));

app.use(
  session({
    name: "url_shortener.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: SECURE_COOKIE,
      sameSite: "lax",
      maxAge: 60 * 60 * 1000
    }
  })
);

app.use((req, _res, next) => {
  if (!req.session.userId) {
    req.session.userId = crypto.randomUUID();
  }
  next();
});

const csrfProtection = csrf();

const linksByCode = new Map();
const codesByOwner = new Map();

function createCode() {
  let code;
  do {
    code = crypto.randomBytes(5).toString("base64url");
  } while (linksByCode.has(code));
  return code;
}

function validateLongUrl(input) {
  if (typeof input !== "string" || input.length > 2048) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(input.trim());
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return null;
  }

  if (!parsed.hostname || parsed.username || parsed.password) {
    return null;
  }

  return parsed.toString();
}

function getOwnedLinks(ownerId) {
  const codes = codesByOwner.get(ownerId) || [];
  return codes
    .map((code) => {
      const link = linksByCode.get(code);
      return link ? { code, url: link.url, createdAt: link.createdAt } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt);
}

// Password hashing helper kept explicit for projects that later add accounts.
// This app has no password storage, database, or SQL surface.
async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

app.get("/", csrfProtection, (req, res) => {
  res.render("index", {
    csrfToken: req.csrfToken(),
    error: null,
    created: null,
    links: getOwnedLinks(req.session.userId)
  });
});

app.post("/shorten", csrfProtection, async (req, res, next) => {
  try {
    const longUrl = validateLongUrl(req.body.longUrl);

    if (!longUrl) {
      return res.status(400).render("index", {
        csrfToken: req.csrfToken(),
        error: "Enter a valid http or https URL without embedded credentials.",
        created: null,
        links: getOwnedLinks(req.session.userId)
      });
    }

    const code = createCode();
    const ownerId = req.session.userId;
    linksByCode.set(code, { url: longUrl, ownerId, createdAt: Date.now() });

    const ownedCodes = codesByOwner.get(ownerId) || [];
    ownedCodes.push(code);
    codesByOwner.set(ownerId, ownedCodes);

    return res.status(201).render("index", {
      csrfToken: req.csrfToken(),
      error: null,
      created: {
        code,
        shortUrl: `${req.protocol}://${req.get("host")}/${code}`,
        url: longUrl
      },
      links: getOwnedLinks(ownerId)
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/:code", (req, res, next) => {
  const code = req.params.code;

  if (!/^[A-Za-z0-9_-]{7}$/.test(code)) {
    return next();
  }

  const link = linksByCode.get(code);
  if (!link) {
    return next();
  }

  return res.redirect(302, link.url);
});

app.use((_req, res) => {
  res.status(404).render("error", {
    status: 404,
    message: "The requested page was not found."
  });
});

app.use((error, _req, res, _next) => {
  if (error.code === "EBADCSRFTOKEN") {
    return res.status(403).render("error", {
      status: 403,
      message: "Your form session expired. Go back and try again."
    });
  }

  return res.status(500).render("error", {
    status: 500,
    message: "Something went wrong."
  });
});

app.listen(PORT, () => {
  console.log(`URL shortener listening on port ${PORT}`);
});

module.exports = { app, hashPassword, validateLongUrl };
