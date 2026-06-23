'use strict';

require('dotenv').config();

const path = require('path');
const http = require('http');
const crypto = require('crypto');

const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const { Server } = require('socket.io');

const authRoutes = require('./src/routes/auth');
const documentRoutes = require('./src/routes/documents');
const { initSockets } = require('./src/socket');
const {
  requireAuth,
  csrfProtection,
  getCsrfToken,
  errorHandler,
} = require('./src/middleware/security');

const PORT = parseInt(process.env.PORT, 10) || 5098;
const isProd = process.env.NODE_ENV === 'production';
const secureCookies = process.env.SECURE_COOKIES === 'true';

// Secrets come from the environment. Fall back to an ephemeral secret in dev so
// the app still runs, but never ship without SESSION_SECRET set.
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (isProd) {
    // eslint-disable-next-line no-console
    console.error('FATAL: SESSION_SECRET must be set in production.');
    process.exit(1);
  }
  sessionSecret = crypto.randomBytes(48).toString('hex');
  // eslint-disable-next-line no-console
  console.warn('[warn] SESSION_SECRET not set — using a random ephemeral secret. Sessions reset on restart.');
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Behind a reverse proxy, trust it so Secure cookies work over forwarded TLS.
if (isProd) app.set('trust proxy', 1);

// ---- Security headers ----------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        // Allow same-origin WebSocket connections for Socket.IO.
        connectSrc: ["'self'", 'ws:', 'wss:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// ---- Body parsing --------------------------------------------------------
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));

// ---- Sessions ------------------------------------------------------------
const sessionMiddleware = session({
  name: 'sid',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,      // not readable by JavaScript -> mitigates XSS theft
    secure: secureCookies, // only sent over HTTPS when enabled
    sameSite: 'lax',     // mitigates CSRF for cross-site navigations
    maxAge: 1000 * 60 * 60 * 8, // 8 hours
  },
});
app.use(sessionMiddleware);

// ---- CSRF token endpoint -------------------------------------------------
// Issues the per-session token the SPA echoes back in the X-CSRF-Token header.
app.get('/api/csrf-token', (req, res) => {
  res.json({ csrfToken: getCsrfToken(req) });
});

// Apply CSRF protection to all state-changing requests.
app.use(csrfProtection);

// ---- API routes ----------------------------------------------------------
app.use('/api/auth', authRoutes);
app.use('/api/documents', requireAuth, documentRoutes);

// ---- Static frontend -----------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback for non-API GET requests.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 for unmatched API routes.
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Centralised error handler (no stack traces to clients).
app.use(errorHandler);

// ---- Real-time -----------------------------------------------------------
initSockets(io, sessionMiddleware);

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Collaborative editor running at http://localhost:${PORT}`);
});

module.exports = { app, server };
