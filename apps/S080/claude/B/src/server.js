'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');

const config = require('./config');
const { csrfProtection } = require('./middleware/csrf');
const { requireAuth } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');

const app = express();

// Behind a reverse proxy in production so Secure cookies work correctly.
if (config.isProduction) {
  app.set('trust proxy', 1);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// Security headers (incl. a strict Content-Security-Policy). We use only
// external CSS and no inline scripts, so the default CSP needs no relaxing.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
  })
);

app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(
  session({
    store: new SQLiteStore({
      db: 'sessions.db',
      dir: path.dirname(config.dbPath),
    }),
    name: 'sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true, // not readable by JS — mitigates XSS cookie theft
      secure: config.isProduction, // only over HTTPS in production
      sameSite: 'lax', // mitigates CSRF
      maxAge: 1000 * 60 * 60, // 1 hour
    },
  })
);

// CSRF token issuance + verification for all state-changing requests.
app.use(csrfProtection);

// Make the current user available to all templates.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.userId
    ? { id: req.session.userId, username: req.session.username, role: req.session.role }
    : null;
  next();
});

// Routes
app.use('/', authRoutes);
app.use('/products', productRoutes);
app.use('/orders', orderRoutes);

app.get('/', requireAuth, (req, res) => {
  res.render('dashboard', { title: 'Dashboard' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: 'Page not found.' });
});

// Centralised error handler — never leak stack traces or internals.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.statusCode || 500;
  // Only show the message for known, safe (operational) errors.
  const message =
    err.expose && err.message ? err.message : 'Something went wrong. Please try again.';
  if (status >= 500) {
    // Log full details server-side only.
    // eslint-disable-next-line no-console
    console.error(err);
  }
  res.status(status).render('error', { title: 'Error', message });
});

const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Warehouse app listening on http://localhost:${config.port}`);
});

module.exports = { app, server };
