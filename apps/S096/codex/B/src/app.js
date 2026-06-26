const crypto = require('crypto');
const path = require('path');
const bcrypt = require('bcrypt');
const csrf = require('csurf');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const { request } = require('undici');
const { z } = require('zod');
const db = require('./db');

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);
const PORT = Number(process.env.PORT || 5096);
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE_SECURE = process.env.SESSION_COOKIE_SECURE !== 'false';

if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('SESSION_SECRET is required in production');
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.static(path.join(__dirname, '..', 'public'), {
  fallthrough: true,
  index: false,
  maxAge: '1h'
}));

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function generateApiKey() {
  return `gw_${crypto.randomBytes(32).toString('base64url')}`;
}

function extractApiKey(req) {
  const authorization = req.get('authorization') || '';
  if (authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim();
  }
  return (req.get('x-api-key') || '').trim();
}

function publicError(res, status, message) {
  return res.status(status).json({ error: message });
}

function safeRedirectTarget(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/dashboard';
}

function getBodyByteCount(req) {
  const length = Number(req.get('content-length') || 0);
  return Number.isFinite(length) && length > 0 ? Math.min(length, 100_000_000) : 0;
}

function recordUsage({ apiKeyId, developerId, method, requestPath, statusCode, responseMs, bytesIn, bytesOut }) {
  db.prepare(`
    INSERT INTO usage_events (api_key_id, developer_id, method, path, status_code, response_ms, bytes_in, bytes_out)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(apiKeyId, developerId, method, requestPath.slice(0, 2048), statusCode, responseMs, bytesIn, bytesOut);
}

app.all('/gateway/*', async (req, res) => {
  const started = Date.now();
  const key = extractApiKey(req);
  if (!key || key.length > 256) {
    return publicError(res, 401, 'Valid API key required');
  }

  const keyHash = sha256(key);
  const apiKey = db.prepare(`
    SELECT ak.id, ak.developer_id, ak.rate_limit_per_minute, ak.enabled, d.backend_url
    FROM api_keys ak
    JOIN developers d ON d.id = ak.developer_id
    WHERE ak.key_hash = ?
  `).get(keyHash);

  if (!apiKey || apiKey.enabled !== 1) {
    return publicError(res, 401, 'Valid API key required');
  }

  if (!apiKey.backend_url) {
    return publicError(res, 502, 'No backend configured for this API key');
  }

  const recentCount = db.prepare(`
    SELECT COUNT(*) AS count
    FROM usage_events
    WHERE api_key_id = ? AND created_at >= datetime('now', '-60 seconds')
  `).get(apiKey.id).count;

  if (recentCount >= apiKey.rate_limit_per_minute) {
    recordUsage({
      apiKeyId: apiKey.id,
      developerId: apiKey.developer_id,
      method: req.method,
      requestPath: req.originalUrl,
      statusCode: 429,
      responseMs: Date.now() - started,
      bytesIn: getBodyByteCount(req),
      bytesOut: 0
    });
    return publicError(res, 429, 'Rate limit exceeded');
  }

  let upstream;
  try {
    upstream = new URL(apiKey.backend_url);
    const gatewayPath = req.params[0] || '';
    upstream.pathname = `${upstream.pathname.replace(/\/$/, '')}/${gatewayPath}`.replace(/\/{2,}/g, '/');
    upstream.search = new URL(req.originalUrl, 'http://gateway.local').search;
  } catch (_error) {
    return publicError(res, 502, 'Invalid backend configuration');
  }

  const headers = { ...req.headers };
  for (const header of ['host', 'connection', 'content-length', 'transfer-encoding', 'upgrade', 'authorization', 'x-api-key']) {
    delete headers[header];
  }
  headers['x-forwarded-host'] = req.get('host') || '';
  headers['x-forwarded-proto'] = req.protocol;
  headers['x-forwarded-for'] = req.ip;

  let statusCode = 502;
  let bytesOut = 0;
  try {
    const proxied = await request(upstream, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : req,
      maxRedirections: 0,
      bodyTimeout: 30_000,
      headersTimeout: 30_000
    });

    statusCode = proxied.statusCode;
    res.status(statusCode);
    for (const [name, value] of Object.entries(proxied.headers)) {
      const lower = name.toLowerCase();
      if (!['connection', 'content-encoding', 'content-length', 'transfer-encoding', 'upgrade'].includes(lower)) {
        res.setHeader(name, value);
      }
    }

    for await (const chunk of proxied.body) {
      bytesOut += chunk.length;
      res.write(chunk);
    }
    res.end();
  } catch (_error) {
    if (!res.headersSent) {
      res.status(502).json({ error: 'Backend request failed' });
    } else {
      res.end();
    }
  } finally {
    recordUsage({
      apiKeyId: apiKey.id,
      developerId: apiKey.developer_id,
      method: req.method,
      requestPath: req.originalUrl,
      statusCode,
      responseMs: Date.now() - started,
      bytesIn: getBodyByteCount(req),
      bytesOut
    });
  }
});

app.use(express.urlencoded({ extended: false, limit: '25kb' }));
app.use(session({
  name: 'gateway.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({
    db: 'sessions.sqlite',
    dir: path.join(process.cwd(), 'data')
  }),
  cookie: {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: 'strict',
    maxAge: 1000 * 60 * 60 * 4
  }
}));

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

const csrfProtection = csrf();

function requireGuest(req, res, next) {
  if (req.session.user) return res.redirect('/dashboard');
  return next();
}

function requireUser(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  return next();
}

function renderWithCsrf(req, res, view, locals = {}) {
  return res.render(view, { ...locals, csrfToken: req.csrfToken() });
}

const registerSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128)
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128)
});

const backendSchema = z.object({
  backend_url: z.string().trim().url().max(2048).refine((value) => {
    try {
      return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch (_error) {
      return false;
    }
  }, 'Backend URL must be HTTP or HTTPS')
});

const keySchema = z.object({
  name: z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9 ._-]+$/, 'Use letters, numbers, spaces, dots, underscores, or hyphens'),
  rate_limit_per_minute: z.coerce.number().int().min(1).max(10000)
});

app.get('/', (req, res) => {
  res.redirect(req.session.user ? '/dashboard' : '/login');
});

app.get('/register', csrfProtection, requireGuest, (req, res) => {
  renderWithCsrf(req, res, 'register');
});

app.post('/register', csrfProtection, requireGuest, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return renderWithCsrf(req, res.status(400), 'register', { error: parsed.error.issues[0].message });
  }

  const existing = db.prepare('SELECT id FROM developers WHERE email = ?').get(parsed.data.email);
  if (existing) {
    return renderWithCsrf(req, res.status(409), 'register', { error: 'An account with that email already exists' });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const result = db.prepare('INSERT INTO developers (email, password_hash) VALUES (?, ?)').run(parsed.data.email, passwordHash);
  req.session.regenerate((error) => {
    if (error) return res.status(500).render('error', { message: 'Unable to create a session' });
    req.session.user = { id: result.lastInsertRowid, email: parsed.data.email };
    res.redirect('/dashboard');
  });
});

app.get('/login', csrfProtection, requireGuest, (req, res) => {
  renderWithCsrf(req, res, 'login');
});

app.post('/login', csrfProtection, requireGuest, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return renderWithCsrf(req, res.status(400), 'login', { error: 'Invalid email or password' });
  }

  const developer = db.prepare('SELECT id, email, password_hash FROM developers WHERE email = ?').get(parsed.data.email);
  const valid = developer ? await bcrypt.compare(parsed.data.password, developer.password_hash) : false;
  if (!valid) {
    return renderWithCsrf(req, res.status(401), 'login', { error: 'Invalid email or password' });
  }

  req.session.regenerate((error) => {
    if (error) return res.status(500).render('error', { message: 'Unable to create a session' });
    req.session.user = { id: developer.id, email: developer.email };
    res.redirect('/dashboard');
  });
});

app.post('/logout', csrfProtection, requireUser, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('gateway.sid');
    res.redirect('/login');
  });
});

app.get('/dashboard', csrfProtection, requireUser, (req, res) => {
  const developer = db.prepare('SELECT id, email, backend_url FROM developers WHERE id = ?').get(req.session.user.id);
  const keys = db.prepare(`
    SELECT
      ak.id,
      ak.name,
      ak.key_prefix,
      ak.rate_limit_per_minute,
      ak.enabled,
      ak.created_at,
      COUNT(ue.id) AS total_requests,
      COALESCE(SUM(CASE WHEN ue.created_at >= datetime('now', '-24 hours') THEN 1 ELSE 0 END), 0) AS requests_24h,
      COALESCE(AVG(CASE WHEN ue.created_at >= datetime('now', '-24 hours') THEN ue.response_ms END), 0) AS avg_response_ms_24h
    FROM api_keys ak
    LEFT JOIN usage_events ue ON ue.api_key_id = ak.id
    WHERE ak.developer_id = ?
    GROUP BY ak.id
    ORDER BY ak.created_at DESC
  `).all(req.session.user.id);
  const recentUsage = db.prepare(`
    SELECT ue.method, ue.path, ue.status_code, ue.response_ms, ue.bytes_out, ue.created_at, ak.name AS key_name
    FROM usage_events ue
    JOIN api_keys ak ON ak.id = ue.api_key_id
    WHERE ue.developer_id = ?
    ORDER BY ue.created_at DESC
    LIMIT 25
  `).all(req.session.user.id);

  renderWithCsrf(req, res, 'dashboard', { developer, keys, recentUsage });
});

app.post('/backend', csrfProtection, requireUser, (req, res) => {
  const parsed = backendSchema.safeParse(req.body);
  if (!parsed.success) {
    req.session.flash = { type: 'error', message: parsed.error.issues[0].message };
    return res.redirect('/dashboard');
  }

  db.prepare('UPDATE developers SET backend_url = ? WHERE id = ?').run(parsed.data.backend_url, req.session.user.id);
  req.session.flash = { type: 'success', message: 'Backend URL updated' };
  res.redirect('/dashboard');
});

app.post('/keys', csrfProtection, requireUser, (req, res) => {
  const parsed = keySchema.safeParse(req.body);
  if (!parsed.success) {
    req.session.flash = { type: 'error', message: parsed.error.issues[0].message };
    return res.redirect('/dashboard');
  }

  const rawKey = generateApiKey();
  db.prepare(`
    INSERT INTO api_keys (developer_id, name, key_hash, key_prefix, rate_limit_per_minute)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.session.user.id, parsed.data.name, sha256(rawKey), rawKey.slice(0, 10), parsed.data.rate_limit_per_minute);

  req.session.flash = {
    type: 'success',
    message: 'API key created. Copy it now; it will not be shown again.',
    apiKey: rawKey
  };
  res.redirect('/dashboard');
});

app.post('/keys/:id/toggle', csrfProtection, requireUser, (req, res) => {
  const keyId = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!keyId.success) {
    req.session.flash = { type: 'error', message: 'Invalid key' };
    return res.redirect('/dashboard');
  }

  const result = db.prepare(`
    UPDATE api_keys
    SET enabled = CASE enabled WHEN 1 THEN 0 ELSE 1 END
    WHERE id = ? AND developer_id = ?
  `).run(keyId.data, req.session.user.id);

  req.session.flash = result.changes === 1
    ? { type: 'success', message: 'API key updated' }
    : { type: 'error', message: 'API key not found' };
  res.redirect(safeRedirectTarget(req.get('referer')));
});

app.post('/keys/:id/delete', csrfProtection, requireUser, (req, res) => {
  const keyId = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!keyId.success) {
    req.session.flash = { type: 'error', message: 'Invalid key' };
    return res.redirect('/dashboard');
  }

  const result = db.prepare('DELETE FROM api_keys WHERE id = ? AND developer_id = ?').run(keyId.data, req.session.user.id);
  req.session.flash = result.changes === 1
    ? { type: 'success', message: 'API key deleted' }
    : { type: 'error', message: 'API key not found' };
  res.redirect('/dashboard');
});

app.use((req, res) => {
  res.status(404).render('error', { message: 'Page not found' });
});

app.use((error, req, res, _next) => {
  if (error.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('error', { message: 'Invalid or expired form token' });
  }
  if (req.path.startsWith('/gateway/')) {
    return res.status(500).json({ error: 'Request failed' });
  }
  return res.status(500).render('error', { message: 'Something went wrong' });
});

app.listen(PORT, () => {
  console.log(`Secure API gateway listening on http://localhost:${PORT}`);
});
