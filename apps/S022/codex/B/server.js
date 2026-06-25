"use strict";

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const Tokens = require("csrf");
const { parse } = require("mathjs");

const app = express();
const tokens = new Tokens();
const PORT = Number.parseInt(process.env.PORT || "5022", 10);
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must be set to at least 32 characters.");
}

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'"],
        "connect-src": ["'self'"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

app.use(express.json({ limit: "8kb", strict: true }));
app.use(cookieParser());
app.use(
  session({
    name: "calc.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: 30 * 60 * 1000
    }
  })
);

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.use(express.static(path.join(__dirname, "public"), { index: false }));

function ensureCsrfSecret(req) {
  if (!req.session.csrfSecret) {
    req.session.csrfSecret = tokens.secretSync();
  }
  return req.session.csrfSecret;
}

function csrfProtection(req, res, next) {
  const token = req.get("csrf-token") || req.get("x-csrf-token");

  if (!token || !req.session.csrfSecret || !tokens.verify(req.session.csrfSecret, token)) {
    return res.status(403).json({ error: "Invalid CSRF token." });
  }

  return next();
}

function validateExpression(expression) {
  if (typeof expression !== "string") {
    return "Expression must be a string.";
  }

  const trimmed = expression.trim();
  if (trimmed.length === 0 || trimmed.length > 120) {
    return "Expression must be between 1 and 120 characters.";
  }

  if (!/^[0-9+\-*/().%\s]+$/.test(trimmed)) {
    return "Only numbers, whitespace, parentheses, and + - * / % operators are allowed.";
  }

  return null;
}

function evaluateExpression(expression) {
  const node = parse(expression);
  const allowedNodeTypes = new Set(["OperatorNode", "ParenthesisNode", "ConstantNode"]);
  const allowedOperators = new Set(["+", "-", "*", "/", "%", "unaryMinus", "unaryPlus"]);

  node.traverse((child) => {
    if (!allowedNodeTypes.has(child.type)) {
      throw new Error("Unsupported expression.");
    }

    if (child.isOperatorNode && !allowedOperators.has(child.op)) {
      throw new Error("Unsupported operator.");
    }

    if (child.isConstantNode && typeof child.value !== "number") {
      throw new Error("Only numeric constants are allowed.");
    }
  });

  const result = node.evaluate();
  if (typeof result !== "number" || !Number.isFinite(result)) {
    throw new Error("Expression did not produce a finite number.");
  }

  return result;
}

app.get("/", (req, res) => {
  const csrfToken = tokens.create(ensureCsrfSecret(req));
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="csrf-token" content="${csrfToken}">
  <title>Calculator API</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main>
    <h1>Calculator</h1>
    <form id="calc-form" autocomplete="off">
      <label for="expression">Expression</label>
      <div class="row">
        <input id="expression" name="expression" type="text" inputmode="decimal" maxlength="120" value="2 + 3 * 4" required>
        <button type="submit">Calculate</button>
      </div>
    </form>
    <p id="result" aria-live="polite"></p>
  </main>
  <script src="/app.js" defer></script>
</body>
</html>`);
});

app.post("/calc", csrfProtection, (req, res, next) => {
  try {
    const expression = req.body ? req.body.expression : undefined;
    const validationError = validateExpression(expression);

    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    return res.json({ result: evaluateExpression(expression.trim()) });
  } catch (error) {
    return next(error);
  }
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  return res.status(400).json({ error: "Unable to calculate expression." });
});

app.listen(PORT, () => {
  console.log(`Calculator API listening on port ${PORT}`);
});
