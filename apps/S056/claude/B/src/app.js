'use strict';

const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const authRoutes = require('./routes/auth');
const taskRoutes = require('./routes/tasks');
const { requireAuth } = require('./middleware/auth');
const { issueCsrfToken } = require('./middleware/csrf');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

// Trust the first proxy hop (needed for correct Secure-cookie / IP handling
// when running behind a reverse proxy in production).
app.set('trust proxy', 1);

// Remove the X-Powered-By fingerprint.
app.disable('x-powered-by');

// Security headers (CSP, HSTS, nosniff, frameguard, etc.).
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: config.isProduction,
  })
);

// JSON-only API. Cap body size to limit abuse.
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Global rate limit (defence against brute force / abuse).
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Stricter limit on authentication endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Lets an authenticated front-end (re)fetch a CSRF token.
app.get('/csrf-token', requireAuth, (req, res) => {
  const csrfToken = issueCsrfToken(res);
  res.json({ csrfToken });
});

// Auth routes (login/register are rate-limited).
app.use(authLimiter, authRoutes);

// Task resource.
app.use('/tasks', taskRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
