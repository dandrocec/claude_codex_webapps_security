'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const db = require('./src/db');
const auth = require('./src/auth');
const { encrypt, decrypt } = require('./src/crypto');
const { startDeployment, emitterFor } = require('./src/runner');
const { ensureSeed } = require('./scripts/seed');

const PORT = process.env.PORT || 5100;

// Seed default users on first run so the app is usable immediately.
ensureSeed();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, 'data') }),
    secret: process.env.SESSION_SECRET || 'dev-dashboard-session-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
  })
);

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  const user = auth.verifyCredentials(username, password);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  req.session.user = user;
  res.json({ user });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  res.json({ user: (req.session && req.session.user) || null });
});

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------
function serializeService(s) {
  let steps = [];
  try {
    steps = JSON.parse(s.steps || '[]');
  } catch {
    steps = [];
  }
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    repo_url: s.repo_url,
    steps,
    created_at: s.created_at,
  };
}

app.get('/api/services', auth.requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM services ORDER BY name').all();
  res.json({ services: rows.map(serializeService) });
});

app.get('/api/services/:id', auth.requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Service not found' });
  res.json({ service: serializeService(row) });
});

app.post('/api/services', auth.requireRole('operator'), (req, res) => {
  const { name, description, repo_url, steps } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Service name is required' });
  }
  const normalizedSteps = normalizeSteps(steps);
  if (normalizedSteps.error) return res.status(400).json({ error: normalizedSteps.error });

  try {
    const info = db
      .prepare(
        'INSERT INTO services (name, description, repo_url, steps, created_by) VALUES (?, ?, ?, ?, ?)'
      )
      .run(
        String(name).trim(),
        description || null,
        repo_url || null,
        JSON.stringify(normalizedSteps.steps),
        req.session.user.id
      );
    const row = db.prepare('SELECT * FROM services WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ service: serializeService(row) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'A service with that name already exists' });
    }
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/services/:id', auth.requireRole('operator'), (req, res) => {
  const existing = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Service not found' });

  const { name, description, repo_url, steps } = req.body || {};
  const normalizedSteps = normalizeSteps(steps);
  if (normalizedSteps.error) return res.status(400).json({ error: normalizedSteps.error });

  db.prepare(
    'UPDATE services SET name = ?, description = ?, repo_url = ?, steps = ? WHERE id = ?'
  ).run(
    name ? String(name).trim() : existing.name,
    description !== undefined ? description : existing.description,
    repo_url !== undefined ? repo_url : existing.repo_url,
    JSON.stringify(normalizedSteps.steps),
    existing.id
  );
  const row = db.prepare('SELECT * FROM services WHERE id = ?').get(existing.id);
  res.json({ service: serializeService(row) });
});

app.delete('/api/services/:id', auth.requireRole('operator'), (req, res) => {
  const info = db.prepare('DELETE FROM services WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Service not found' });
  res.json({ ok: true });
});

function normalizeSteps(steps) {
  if (steps === undefined || steps === null) return { steps: [] };
  if (!Array.isArray(steps)) return { error: 'steps must be an array of { name, command }' };
  const out = [];
  for (const s of steps) {
    if (!s || typeof s.command !== 'string' || !s.command.trim()) {
      return { error: 'Each step needs a non-empty "command"' };
    }
    out.push({ name: (s.name && String(s.name).trim()) || s.command.trim(), command: s.command.trim() });
  }
  return { steps: out };
}

// ---------------------------------------------------------------------------
// Secrets (per service). Values are never returned to clients.
// ---------------------------------------------------------------------------
app.get('/api/services/:id/secrets', auth.requireAuth, (req, res) => {
  const service = db.prepare('SELECT id FROM services WHERE id = ?').get(req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found' });
  const rows = db
    .prepare('SELECT key, updated_at FROM secrets WHERE service_id = ? ORDER BY key')
    .all(req.params.id);
  res.json({ secrets: rows });
});

app.put('/api/services/:id/secrets/:key', auth.requireRole('operator'), (req, res) => {
  const service = db.prepare('SELECT id FROM services WHERE id = ?').get(req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found' });

  const key = String(req.params.key).trim();
  const { value } = req.body || {};
  if (!key) return res.status(400).json({ error: 'Secret key is required' });
  if (value === undefined || value === null) {
    return res.status(400).json({ error: 'Secret value is required' });
  }

  const enc = encrypt(value);
  db.prepare(
    `INSERT INTO secrets (service_id, key, value_encrypted, iv, tag, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(service_id, key)
     DO UPDATE SET value_encrypted = excluded.value_encrypted,
                   iv = excluded.iv,
                   tag = excluded.tag,
                   updated_at = datetime('now')`
  ).run(service.id, key, enc.value_encrypted, enc.iv, enc.tag);

  res.json({ ok: true, key });
});

app.delete('/api/services/:id/secrets/:key', auth.requireRole('operator'), (req, res) => {
  const info = db
    .prepare('DELETE FROM secrets WHERE service_id = ? AND key = ?')
    .run(req.params.id, String(req.params.key).trim());
  if (info.changes === 0) return res.status(404).json({ error: 'Secret not found' });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Deployments
// ---------------------------------------------------------------------------
app.get('/api/deployments', auth.requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT d.*, s.name AS service_name, u.username AS triggered_by_name
       FROM deployments d
       JOIN services s ON s.id = d.service_id
       LEFT JOIN users u ON u.id = d.triggered_by
       ORDER BY d.id DESC
       LIMIT 100`
    )
    .all();
  res.json({ deployments: rows });
});

app.get('/api/services/:id/deployments', auth.requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT d.*, u.username AS triggered_by_name
       FROM deployments d
       LEFT JOIN users u ON u.id = d.triggered_by
       WHERE d.service_id = ?
       ORDER BY d.id DESC
       LIMIT 100`
    )
    .all(req.params.id);
  res.json({ deployments: rows });
});

app.post('/api/services/:id/deploy', auth.requireRole('operator'), (req, res) => {
  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found' });
  const deploymentId = startDeployment(service.id, req.session.user.id);
  res.status(202).json({ deployment_id: deploymentId });
});

app.get('/api/deployments/:id', auth.requireAuth, (req, res) => {
  const dep = db
    .prepare(
      `SELECT d.*, s.name AS service_name, u.username AS triggered_by_name
       FROM deployments d
       JOIN services s ON s.id = d.service_id
       LEFT JOIN users u ON u.id = d.triggered_by
       WHERE d.id = ?`
    )
    .get(req.params.id);
  if (!dep) return res.status(404).json({ error: 'Deployment not found' });
  res.json({ deployment: dep });
});

app.get('/api/deployments/:id/logs', auth.requireAuth, (req, res) => {
  const dep = db.prepare('SELECT id FROM deployments WHERE id = ?').get(req.params.id);
  if (!dep) return res.status(404).json({ error: 'Deployment not found' });
  const rows = db
    .prepare('SELECT id, ts, stream, line FROM logs WHERE deployment_id = ? ORDER BY id')
    .all(req.params.id);
  res.json({ logs: rows });
});

// Server-Sent Events: stream stored + live logs for a deployment.
app.get('/api/deployments/:id/stream', auth.requireAuth, (req, res) => {
  const deploymentId = Number(req.params.id);
  const dep = db.prepare('SELECT * FROM deployments WHERE id = ?').get(deploymentId);
  if (!dep) return res.status(404).json({ error: 'Deployment not found' });

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Replay everything stored so far.
  const history = db
    .prepare('SELECT id, ts, stream, line FROM logs WHERE deployment_id = ? ORDER BY id')
    .all(deploymentId);
  let lastId = 0;
  for (const row of history) {
    send('log', row);
    lastId = row.id;
  }

  // If already finished, close after replay.
  if (dep.status === 'success' || dep.status === 'failed') {
    send('end', { status: dep.status });
    return res.end();
  }

  const em = emitterFor(deploymentId);
  const onLog = (row) => {
    if (row.id > lastId) {
      send('log', row);
      lastId = row.id;
    }
  };
  const onEnd = (data) => {
    send('end', data);
    cleanup();
    res.end();
  };
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);

  function cleanup() {
    clearInterval(keepAlive);
    em.removeListener('log', onLog);
    em.removeListener('end', onEnd);
  }

  em.on('log', onLog);
  em.on('end', onEnd);
  req.on('close', cleanup);
});

// ---------------------------------------------------------------------------
// Static frontend
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`DevOps dashboard listening on http://localhost:${PORT}`);
});
