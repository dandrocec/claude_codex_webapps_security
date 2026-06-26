const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, param, validationResult } = require('express-validator');

const db = require('./db');
const { sendOutbound, validateTarget } = require('./ssrf');
const views = require('./views');

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);
const PORT = Number(process.env.PORT || 5094);
const SESSION_SECRET = process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? null : crypto.randomBytes(32).toString('hex'));

if (!SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required in production');
}

app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'"],
      scriptSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  referrerPolicy: { policy: 'no-referrer' }
}));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(express.json({ limit: '128kb', type: ['application/json', 'application/*+json'] }));
app.use('/hook', express.raw({ type: '*/*', limit: '128kb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));
app.use(session({
  name: 'hub.sid',
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: './data' }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.SESSION_SECURE !== 'false',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use('/styles.css', (_req, res) => {
  res.type('text/css').send(`
body{font-family:Arial,sans-serif;margin:0;background:#f6f7f9;color:#1f2933}header{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;background:#111827;color:white}h1{font-size:22px;margin:0}nav{display:flex;gap:12px;align-items:center}nav a,nav button{color:white;background:transparent;border:1px solid #6b7280;padding:8px 10px;text-decoration:none;border-radius:6px}main{padding:24px;max-width:1200px;margin:auto}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:18px}.panel{background:white;border:1px solid #d6dbe1;border-radius:8px;padding:18px;margin-bottom:18px}.narrow{max-width:420px;margin:40px auto}form{display:grid;gap:10px}label{display:grid;gap:5px;font-weight:600}input,select,button{font:inherit;padding:9px;border:1px solid #b8c0cc;border-radius:6px}button{background:#1f5eff;color:white;border-color:#1f5eff;cursor:pointer}table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border-top:1px solid #e1e5eb;padding:9px;text-align:left;vertical-align:top}code,pre{white-space:pre-wrap;word-break:break-word;max-width:480px}pre{margin:0;font-size:12px}.error,.bad{color:#b42318}.ok{color:#067647}.flash{background:#e8f1ff;border:1px solid #bdd4ff;padding:10px;border-radius:6px}
`);
});

function csrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  return req.session.csrfToken;
}

function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path.startsWith('/hook/')) return next();
  if (!req.session.csrfToken || !req.body || req.body._csrf !== req.session.csrfToken) {
    return res.status(403).send('Invalid CSRF token');
  }
  next();
}

function render(req, res, title, body, status = 200) {
  res.status(status).send(views.layout({
    title,
    user: req.session.user,
    csrfToken: csrfToken(req),
    flash: req.session.flash,
    body
  }));
  req.session.flash = '';
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function validationErrors(req) {
  return validationResult(req).array().map((error) => ({ msg: error.msg }));
}

function flash(req, message) {
  req.session.flash = message;
}

app.use(csrfProtection);

app.get('/', (req, res) => res.redirect(req.session.user ? '/dashboard' : '/login'));

app.get('/register', (req, res) => render(req, res, 'Register', views.authPage({ mode: 'register', csrfToken: csrfToken(req) })));
app.post('/register',
  body('email').isEmail().normalizeEmail().isLength({ max: 254 }),
  body('password').isLength({ min: 12, max: 128 }).withMessage('Password must be 12 to 128 characters.'),
  async (req, res, next) => {
    try {
      const errors = validationErrors(req);
      if (errors.length) return render(req, res, 'Register', views.authPage({ mode: 'register', csrfToken: csrfToken(req), errors }), 400);
      const passwordHash = await bcrypt.hash(req.body.password, 12);
      const insert = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)');
      const result = insert.run(req.body.email, passwordHash);
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.user = { id: result.lastInsertRowid, email: req.body.email };
        res.redirect('/dashboard');
      });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return render(req, res, 'Register', views.authPage({ mode: 'register', csrfToken: csrfToken(req), errors: [{ msg: 'Email is already registered.' }] }), 409);
      }
      next(error);
    }
  }
);

app.get('/login', (req, res) => render(req, res, 'Login', views.authPage({ mode: 'login', csrfToken: csrfToken(req) })));
app.post('/login',
  body('email').isEmail().normalizeEmail().isLength({ max: 254 }),
  body('password').isLength({ min: 1, max: 128 }),
  async (req, res, next) => {
    try {
      const errors = validationErrors(req);
      if (errors.length) return render(req, res, 'Login', views.authPage({ mode: 'login', csrfToken: csrfToken(req), errors }), 400);
      const user = db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?').get(req.body.email);
      if (!user || !(await bcrypt.compare(req.body.password, user.password_hash))) {
        return render(req, res, 'Login', views.authPage({ mode: 'login', csrfToken: csrfToken(req), errors: [{ msg: 'Invalid email or password.' }] }), 401);
      }
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.user = { id: user.id, email: user.email };
        res.redirect('/dashboard');
      });
    } catch (error) {
      next(error);
    }
  }
);

app.post('/logout', requireAuth, (req, res) => req.session.destroy(() => res.redirect('/login')));

app.get('/dashboard', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const webhooks = db.prepare('SELECT id, name, token FROM webhooks WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  const actions = db.prepare('SELECT id, name, method, url FROM actions WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  const events = db.prepare(`
    SELECT events.id, events.payload, events.created_at, webhooks.name AS webhook_name
    FROM events JOIN webhooks ON webhooks.id = events.webhook_id
    WHERE events.user_id = ? ORDER BY events.created_at DESC LIMIT 25
  `).all(userId);
  const deliveries = db.prepare(`
    SELECT deliveries.*, actions.name AS action_name
    FROM deliveries JOIN actions ON actions.id = deliveries.action_id
    WHERE deliveries.user_id = ? ORDER BY deliveries.created_at DESC LIMIT 50
  `).all(userId);
  render(req, res, 'Dashboard', views.dashboard({ csrfToken: csrfToken(req), webhooks, actions, events, deliveries, origin: `${req.protocol}://${req.get('host')}` }));
});

app.post('/webhooks',
  requireAuth,
  body('name').trim().isLength({ min: 1, max: 80 }),
  (req, res) => {
    const errors = validationErrors(req);
    if (errors.length) {
      flash(req, errors[0].msg);
      return res.redirect('/dashboard');
    }
    db.prepare('INSERT INTO webhooks (user_id, name, token) VALUES (?, ?, ?)').run(req.session.user.id, req.body.name, crypto.randomBytes(24).toString('hex'));
    res.redirect('/dashboard');
  }
);

app.post('/webhooks/:id/delete',
  requireAuth,
  param('id').isInt({ min: 1 }),
  (req, res) => {
    if (!validationResult(req).isEmpty()) return res.status(400).send('Bad request');
    db.prepare('DELETE FROM webhooks WHERE id = ? AND user_id = ?').run(req.params.id, req.session.user.id);
    res.redirect('/dashboard');
  }
);

app.post('/actions',
  requireAuth,
  body('name').trim().isLength({ min: 1, max: 80 }),
  body('webhookId').isInt({ min: 1 }),
  body('method').isIn(['POST', 'PUT', 'PATCH']),
  body('url').trim().isURL({ protocols: ['http', 'https'], require_protocol: true }).isLength({ max: 2048 }),
  async (req, res, next) => {
    try {
      const errors = validationErrors(req);
      if (errors.length) {
        flash(req, errors[0].msg);
        return res.redirect('/dashboard');
      }
      const hook = db.prepare('SELECT id FROM webhooks WHERE id = ? AND user_id = ?').get(req.body.webhookId, req.session.user.id);
      if (!hook) return res.status(404).send('Not found');
      await validateTarget(req.body.url);
      db.prepare('INSERT INTO actions (user_id, webhook_id, name, method, url) VALUES (?, ?, ?, ?, ?)').run(req.session.user.id, hook.id, req.body.name, req.body.method, req.body.url);
      res.redirect('/dashboard');
    } catch (error) {
      flash(req, error.message);
      res.redirect('/dashboard');
    }
  }
);

app.post('/actions/:id/delete',
  requireAuth,
  param('id').isInt({ min: 1 }),
  (req, res) => {
    if (!validationResult(req).isEmpty()) return res.status(400).send('Bad request');
    db.prepare('DELETE FROM actions WHERE id = ? AND user_id = ?').run(req.params.id, req.session.user.id);
    res.redirect('/dashboard');
  }
);

async function deliver(event, action, attempt = 1) {
  const result = await sendOutbound({
    method: action.method,
    url: action.url,
    payload: {
      eventId: event.id,
      webhookId: event.webhook_id,
      receivedAt: event.created_at,
      payload: JSON.parse(event.payload)
    }
  });
  db.prepare(`
    INSERT INTO deliveries (user_id, event_id, action_id, attempt, status, status_code, response_body, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(event.user_id, event.id, action.id, attempt, result.ok ? 'success' : 'failed', result.statusCode, result.body ? result.body.slice(0, 4096) : null, result.error ? result.error.slice(0, 512) : null);
}

app.post('/hook/:token',
  param('token').isHexadecimal().isLength({ min: 48, max: 48 }),
  async (req, res, next) => {
    try {
      if (!validationResult(req).isEmpty()) return res.status(404).json({ error: 'Not found' });
      const hook = db.prepare('SELECT id, user_id FROM webhooks WHERE token = ?').get(req.params.token);
      if (!hook) return res.status(404).json({ error: 'Not found' });
      const payload = req.body && Object.keys(req.body).length ? req.body : {};
      const eventPayload = JSON.stringify(payload).slice(0, 131072);
      const result = db.prepare('INSERT INTO events (user_id, webhook_id, request_ip, payload) VALUES (?, ?, ?, ?)').run(hook.user_id, hook.id, req.ip, eventPayload);
      const event = db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid);
      const actions = db.prepare('SELECT * FROM actions WHERE webhook_id = ? AND user_id = ? AND enabled = 1').all(hook.id, hook.user_id);
      await Promise.all(actions.map((action) => deliver(event, action)));
      res.status(202).json({ accepted: true, deliveries: actions.length });
    } catch (error) {
      next(error);
    }
  }
);

app.post('/deliveries/:id/retry',
  requireAuth,
  param('id').isInt({ min: 1 }),
  async (req, res, next) => {
    try {
      if (!validationResult(req).isEmpty()) return res.status(400).send('Bad request');
      const delivery = db.prepare('SELECT * FROM deliveries WHERE id = ? AND user_id = ?').get(req.params.id, req.session.user.id);
      if (!delivery) return res.status(404).send('Not found');
      const event = db.prepare('SELECT * FROM events WHERE id = ? AND user_id = ?').get(delivery.event_id, req.session.user.id);
      const action = db.prepare('SELECT * FROM actions WHERE id = ? AND user_id = ?').get(delivery.action_id, req.session.user.id);
      if (!event || !action) return res.status(404).send('Not found');
      const maxAttempt = db.prepare('SELECT COALESCE(MAX(attempt), 0) AS max_attempt FROM deliveries WHERE event_id = ? AND action_id = ? AND user_id = ?')
        .get(event.id, action.id, req.session.user.id).max_attempt;
      await deliver(event, action, maxAttempt + 1);
      res.redirect('/dashboard');
    } catch (error) {
      next(error);
    }
  }
);

app.use((_req, res) => res.status(404).send('Not found'));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).send('Internal server error');
});

app.listen(PORT, () => {
  console.log(`Integration Hub listening on port ${PORT}`);
});
