'use strict';

const path = require('node:path');
const express = require('express');

const { db, DB_PATH } = require('./db');
const { generateKey, hashKey } = require('./keys');

const PORT = Number(process.env.PORT) || 5096;
// The backend that valid requests are proxied to. Defaults to a public test API
// so the gateway works out of the box with zero configuration.
const BACKEND_URL = (process.env.BACKEND_URL || 'https://jsonplaceholder.typicode.com')
  .replace(/\/+$/, '');

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------
const stmt = {
  insertDeveloper: db.prepare(
    'INSERT INTO developers (name, email) VALUES (?, ?)'
  ),
  getDeveloper: db.prepare('SELECT id, name, email, created_at FROM developers WHERE id = ?'),
  getDeveloperByEmail: db.prepare('SELECT id, name, email, created_at FROM developers WHERE email = ?'),

  insertKey: db.prepare(
    `INSERT INTO api_keys (developer_id, label, key_hash, key_prefix, rate_limit)
     VALUES (?, ?, ?, ?, ?)`
  ),
  getKeyByHash: db.prepare(
    `SELECT id, developer_id, label, rate_limit, revoked
     FROM api_keys WHERE key_hash = ?`
  ),
  listKeysForDeveloper: db.prepare(
    `SELECT id, label, key_prefix, rate_limit, revoked, created_at
     FROM api_keys WHERE developer_id = ? ORDER BY id`
  ),
  revokeKey: db.prepare('UPDATE api_keys SET revoked = 1 WHERE id = ? AND developer_id = ?'),

  insertUsage: db.prepare(
    `INSERT INTO usage_logs
       (api_key_id, ts_epoch_ms, method, path, status_code, duration_ms, rate_limited)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ),
  countRecentForKey: db.prepare(
    `SELECT COUNT(*) AS n FROM usage_logs
     WHERE api_key_id = ? AND rate_limited = 0 AND ts_epoch_ms >= ?`
  ),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function recordUsage(apiKeyId, { method, path: reqPath, status, duration, rateLimited }) {
  stmt.insertUsage.run(
    apiKeyId,
    Date.now(),
    method,
    reqPath,
    status,
    Math.round(duration),
    rateLimited ? 1 : 0
  );
}

// ---------------------------------------------------------------------------
// Developer registration & key management API
// ---------------------------------------------------------------------------

// Register a developer.
app.post('/register', (req, res) => {
  const { name, email } = req.body || {};
  if (!isNonEmptyString(name) || !isNonEmptyString(email)) {
    return res.status(400).json({ error: 'name and email are required' });
  }
  try {
    const info = stmt.insertDeveloper.run(name.trim(), email.trim().toLowerCase());
    const dev = stmt.getDeveloper.get(info.lastInsertRowid);
    return res.status(201).json(dev);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'a developer with that email already exists' });
    }
    throw err;
  }
});

// Generate a new API key for a developer. The raw key is returned ONCE here.
app.post('/developers/:id/keys', (req, res) => {
  const developerId = Number(req.params.id);
  const dev = stmt.getDeveloper.get(developerId);
  if (!dev) return res.status(404).json({ error: 'developer not found' });

  const label = isNonEmptyString(req.body?.label) ? req.body.label.trim() : 'default';
  let rateLimit = Number(req.body?.rate_limit);
  if (!Number.isInteger(rateLimit) || rateLimit <= 0) rateLimit = 60;

  const key = generateKey();
  const info = stmt.insertKey.run(developerId, label, key.hash, key.prefix, rateLimit);

  return res.status(201).json({
    id: info.lastInsertRowid,
    label,
    rate_limit: rateLimit,
    api_key: key.raw, // shown once — store it now
    note: 'Store this key now. It will not be shown again.',
  });
});

// List a developer's keys (never returns the secret).
app.get('/developers/:id/keys', (req, res) => {
  const developerId = Number(req.params.id);
  const dev = stmt.getDeveloper.get(developerId);
  if (!dev) return res.status(404).json({ error: 'developer not found' });
  return res.json(stmt.listKeysForDeveloper.all(developerId));
});

// Revoke a key.
app.delete('/developers/:id/keys/:keyId', (req, res) => {
  const developerId = Number(req.params.id);
  const keyId = Number(req.params.keyId);
  const info = stmt.revokeKey.run(keyId, developerId);
  if (info.changes === 0) return res.status(404).json({ error: 'key not found' });
  return res.json({ id: keyId, revoked: true });
});

// ---------------------------------------------------------------------------
// Dashboard data API
// ---------------------------------------------------------------------------

// Per-developer usage summary used by the dashboard.
app.get('/developers/:id/usage', (req, res) => {
  const developerId = Number(req.params.id);
  const dev = stmt.getDeveloper.get(developerId);
  if (!dev) return res.status(404).json({ error: 'developer not found' });

  const windowStart = Date.now() - 60_000;
  const keys = stmt.listKeysForDeveloper.all(developerId).map((k) => {
    const totals = db
      .prepare(
        `SELECT
           COUNT(*)                                              AS total_requests,
           COALESCE(SUM(rate_limited), 0)                        AS throttled,
           COALESCE(SUM(CASE WHEN status_code >= 200 AND status_code < 400 AND rate_limited = 0 THEN 1 ELSE 0 END), 0) AS success,
           COALESCE(ROUND(AVG(CASE WHEN rate_limited = 0 THEN duration_ms END), 1), 0) AS avg_ms,
           MAX(ts)                                               AS last_used
         FROM usage_logs WHERE api_key_id = ?`
      )
      .get(k.id);
    const recent = stmt.countRecentForKey.get(k.id, windowStart);
    return {
      ...k,
      ...totals,
      current_minute: recent.n,
      remaining_this_minute: Math.max(0, k.rate_limit - recent.n),
    };
  });

  const recentLogs = db
    .prepare(
      `SELECT l.ts, l.method, l.path, l.status_code, l.duration_ms, l.rate_limited, k.key_prefix, k.label
       FROM usage_logs l JOIN api_keys k ON k.id = l.api_key_id
       WHERE k.developer_id = ?
       ORDER BY l.id DESC LIMIT 50`
    )
    .all(developerId);

  return res.json({ developer: dev, keys, recent_requests: recentLogs });
});

// ---------------------------------------------------------------------------
// The gateway / proxy
// ---------------------------------------------------------------------------

// Authenticate the incoming key. Looks for `x-api-key` header or `?api_key=`.
function authenticateKey(req, res, next) {
  const raw = req.get('x-api-key') || req.query.api_key;
  if (!isNonEmptyString(raw)) {
    return res.status(401).json({ error: 'missing API key (send the x-api-key header)' });
  }
  const record = stmt.getKeyByHash.get(hashKey(raw.trim()));
  if (!record) return res.status(401).json({ error: 'invalid API key' });
  if (record.revoked) return res.status(403).json({ error: 'API key has been revoked' });
  req.apiKey = record;
  next();
}

// Sliding-window (per-minute) rate limit enforced from the usage table.
function enforceRateLimit(req, res, next) {
  const windowStart = Date.now() - 60_000;
  const { n } = stmt.countRecentForKey.get(req.apiKey.id, windowStart);
  res.set('X-RateLimit-Limit', String(req.apiKey.rate_limit));
  res.set('X-RateLimit-Remaining', String(Math.max(0, req.apiKey.rate_limit - n - 1)));
  if (n >= req.apiKey.rate_limit) {
    recordUsage(req.apiKey.id, {
      method: req.method,
      path: req.params[0] ? '/' + req.params[0] : '/',
      status: 429,
      duration: 0,
      rateLimited: true,
    });
    return res
      .status(429)
      .json({ error: 'rate limit exceeded', limit: req.apiKey.rate_limit, window: '60s' });
  }
  next();
}

// Proxy everything under /gateway/* to the configured backend.
app.all('/gateway/*', authenticateKey, enforceRateLimit, async (req, res) => {
  const subPath = '/' + (req.params[0] || '');
  const qs = req.originalUrl.includes('?')
    ? req.originalUrl.slice(req.originalUrl.indexOf('?'))
    : '';
  const targetUrl = BACKEND_URL + subPath + qs;
  const started = performance.now();

  // Forward most headers, but strip hop-by-hop / gateway-specific ones.
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    const lk = k.toLowerCase();
    if (['host', 'x-api-key', 'connection', 'content-length'].includes(lk)) continue;
    headers[k] = v;
  }

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    const duration = performance.now() - started;

    recordUsage(req.apiKey.id, {
      method: req.method,
      path: subPath,
      status: upstream.status,
      duration,
      rateLimited: false,
    });

    // Pass through content type + status.
    const ct = upstream.headers.get('content-type');
    if (ct) res.set('content-type', ct);
    res.set('X-Gateway-Backend', BACKEND_URL);
    return res.status(upstream.status).send(buf);
  } catch (err) {
    const duration = performance.now() - started;
    recordUsage(req.apiKey.id, {
      method: req.method,
      path: subPath,
      status: 502,
      duration,
      rateLimited: false,
    });
    return res.status(502).json({ error: 'bad gateway', detail: String(err.message) });
  }
});

// ---------------------------------------------------------------------------
// Static dashboard + health
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) =>
  res.json({ status: 'ok', backend: BACKEND_URL, db: path.basename(DB_PATH) })
);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`API gateway listening on http://localhost:${PORT}`);
  console.log(`  Dashboard:  http://localhost:${PORT}/`);
  console.log(`  Proxying /gateway/* -> ${BACKEND_URL}`);
});
