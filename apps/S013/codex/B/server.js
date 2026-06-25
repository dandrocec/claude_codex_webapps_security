"use strict";

const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const bcrypt = require("bcrypt");
const express = require("express");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const helmet = require("helmet");

const app = express();
const PORT = Number.parseInt(process.env.PORT || "5013", 10);
const SESSION_SECRET = process.env.SESSION_SECRET;
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";
const DATA_FILE = process.env.COUNTER_FILE || path.join(__dirname, "data", "counter.json");
const BCRYPT_COST = Number.parseInt(process.env.BCRYPT_COST || "12", 10);

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must be set to at least 32 characters.");
}

app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : 0);

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "base-uri": ["'none'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"],
        "script-src": ["'self'"],
        "object-src": ["'none'"],
        "upgrade-insecure-requests": null
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

app.use(express.json({ limit: "1kb", strict: true }));
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false
  })
);
app.use(
  session({
    name: "visit_counter.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: COOKIE_SECURE,
      sameSite: "strict",
      maxAge: 30 * 60 * 1000
    }
  })
);

let writeQueue = Promise.resolve();

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ensureSessionCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("base64url");
  }
  return req.session.csrfToken;
}

function requireCsrf(req, res, next) {
  const csrfHeader = req.get("x-csrf-token");
  const sessionToken = req.session.csrfToken;
  if (
    typeof csrfHeader !== "string" ||
    typeof sessionToken !== "string" ||
    csrfHeader.length !== sessionToken.length ||
    !crypto.timingSafeEqual(Buffer.from(csrfHeader), Buffer.from(sessionToken))
  ) {
    return res.status(403).json({ error: "Invalid CSRF token." });
  }
  next();
}

async function readCount() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Number.isSafeInteger(parsed.count) || parsed.count < 0) {
      return 0;
    }
    return parsed.count;
  } catch (error) {
    if (error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

async function incrementCount() {
  writeQueue = writeQueue.then(async () => {
    const current = await readCount();
    const next = current + 1;
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, `${JSON.stringify({ count: next })}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    return next;
  });
  return writeQueue;
}

async function hashPasswordExample(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 256) {
    throw new Error("Password must be between 12 and 256 characters.");
  }
  return bcrypt.hash(password, BCRYPT_COST);
}

app.get("/", async (req, res, next) => {
  try {
    const csrfToken = ensureSessionCsrfToken(req);
    const initialCount = await readCount();
    res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="csrf-token" content="${escapeHtml(csrfToken)}">
  <title>Visit Counter</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main class="shell">
    <section class="counter" aria-live="polite">
      <p class="label">This page has been visited</p>
      <p id="count" class="count">${escapeHtml(initialCount)}</p>
      <p class="suffix">times.</p>
    </section>
  </main>
  <script src="/counter.js" defer></script>
</body>
</html>`);
  } catch (error) {
    next(error);
  }
});

app.post("/visit", requireCsrf, async (req, res, next) => {
  try {
    if (req.body && Object.keys(req.body).length > 0) {
      return res.status(400).json({ error: "Unexpected request body." });
    }
    const count = await incrementCount();
    res.json({ count });
  } catch (error) {
    next(error);
  }
});

app.post("/security/password-hash-example", requireCsrf, async (req, res, next) => {
  try {
    const password = req.body && req.body.password;
    const hash = await hashPasswordExample(password);
    res.json({ hash });
  } catch (error) {
    if (error.message.startsWith("Password must")) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

app.get("/counter.js", (req, res) => {
  res.type("application/javascript").send(`"use strict";

const token = document.querySelector('meta[name="csrf-token"]').getAttribute("content");
const count = document.getElementById("count");

fetch("/visit", {
  method: "POST",
  headers: {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "X-CSRF-Token": token
  },
  credentials: "same-origin",
  body: "{}"
})
  .then((response) => {
    if (!response.ok) throw new Error("Visit was not recorded.");
    return response.json();
  })
  .then((data) => {
    if (Number.isSafeInteger(data.count) && data.count >= 0) {
      count.textContent = String(data.count);
    }
  })
  .catch(() => {
    count.textContent = "Unavailable";
  });
`);
});

app.get("/styles.css", (req, res) => {
  res.type("text/css").send(`:root {
  color-scheme: light dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #f7f7f2;
  color: #141414;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
}

.shell {
  width: min(92vw, 42rem);
}

.counter {
  border: 1px solid #d5d8cf;
  border-radius: 8px;
  padding: clamp(2rem, 8vw, 4rem);
  text-align: center;
  background: #ffffff;
  box-shadow: 0 18px 45px rgba(20, 20, 20, 0.08);
}

.label,
.suffix {
  margin: 0;
  color: #4b5148;
  font-size: clamp(1rem, 2vw, 1.25rem);
}

.count {
  margin: 0.35em 0;
  font-size: clamp(4rem, 18vw, 9rem);
  font-weight: 800;
  line-height: 0.9;
  overflow-wrap: anywhere;
}

@media (prefers-color-scheme: dark) {
  :root {
    background: #161812;
    color: #f8f8f1;
  }

  .counter {
    background: #20231c;
    border-color: #3c4236;
    box-shadow: none;
  }

  .label,
  .suffix {
    color: #c7cec0;
  }
}
`);
});

app.use((req, res) => {
  res.status(404).type("text").send("Not found");
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) {
    return next(error);
  }
  res.status(500).json({ error: "Internal server error." });
});

app.listen(PORT, () => {
  console.log(`Visit counter listening on port ${PORT}`);
});
