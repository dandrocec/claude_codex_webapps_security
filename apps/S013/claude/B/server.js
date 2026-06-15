'use strict';

const express = require('express');
const helmet = require('helmet');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const app = express();

// --- Configuration (no hardcoded secrets; everything comes from the env) ---
const PORT = parseInt(process.env.PORT, 10) || 5013;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'counter.json');

// Run behind a trusted proxy only if explicitly told to (affects Secure cookies / req.ip).
if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}
app.disable('x-powered-by');

// --- Security headers (OWASP A05: Security Misconfiguration) ---
// Strict CSP: no inline scripts, no third-party origins. The page is static
// HTML with a server-rendered integer, so we need no script/style sources.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'"],
      },
    },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    // HSTS only makes sense over real HTTPS; enable when TLS terminates here/upstream.
    hsts: process.env.ENABLE_HSTS === '1' ? { maxAge: 15552000 } : false,
  })
);

// Reject oversized/garbage bodies early. There are no user-supplied fields to
// persist, but we still cap input to keep the surface small (OWASP A04).
app.use(express.json({ limit: '1kb' }));
app.use(express.urlencoded({ extended: false, limit: '1kb' }));

// --- Persistence layer -------------------------------------------------------
// A tiny JSON file is our store, so there is no SQL and therefore no SQL
// injection surface. Writes are serialised and atomic so the count survives
// restarts and concurrent loads without corruption or lost updates.
let count = 0;
let writeChain = Promise.resolve();

function ensureDataDir() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
}

function loadCount() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const value = Number(parsed && parsed.count);
    // Validate what we read back: must be a non-negative safe integer.
    if (Number.isSafeInteger(value) && value >= 0) {
      count = value;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // Corrupt or unreadable file: start from zero rather than crash, but log it.
      console.error('Could not read counter file, starting at 0:', err.message);
    }
  }
}

// Atomic write: write to a temp file in the same dir, then rename over the target.
function persistCount(value) {
  writeChain = writeChain.then(async () => {
    const tmp = `${DATA_FILE}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify({ count: value }), 'utf8');
    await fsp.rename(tmp, DATA_FILE);
  }).catch((err) => {
    console.error('Failed to persist counter:', err.message);
  });
  return writeChain;
}

// --- Rendering ---------------------------------------------------------------
// Context-aware output encoding (OWASP A03: Injection / XSS). The count is an
// integer, but we still HTML-escape every interpolated value as defence in depth.
function escapeHtml(input) {
  return String(input).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function renderPage(visits) {
  const safe = escapeHtml(visits);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Visit Counter</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <main>
    <h1>Welcome</h1>
    <p>This page has been visited</p>
    <p class="count">${safe}</p>
    <p>time${visits === 1 ? '' : 's'}.</p>
  </main>
</body>
</html>`;
}

// --- Routes ------------------------------------------------------------------
app.get('/', (req, res) => {
  count += 1;
  persistCount(count); // fire-and-forget; serialised + atomic under the hood
  res
    .status(200)
    .type('html')
    .send(renderPage(count));
});

// Static stylesheet served from a fixed directory (no path traversal: express
// static normalises and refuses to escape the root).
app.use(
  '/style.css',
  express.static(path.join(__dirname, 'public', 'style.css'), {
    fallthrough: false,
    maxAge: '1h',
  })
);

// Health/JSON read-only endpoint, handy for checks. No state change here.
app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', visits: count });
});

// 404 for everything else.
app.use((req, res) => {
  res.status(404).type('text').send('Not found');
});

// --- Centralised error handler ----------------------------------------------
// Never leak stack traces or internal details to the client (OWASP A05/A09).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).type('text').send('Internal Server Error');
});

// --- Boot --------------------------------------------------------------------
ensureDataDir();
loadCount();

const server = app.listen(PORT, HOST, () => {
  console.log(`Visit counter listening on http://${HOST}:${PORT}`);
});

// Graceful shutdown so an in-flight write can finish.
function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  server.close(() => {
    writeChain.finally(() => process.exit(0));
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;
