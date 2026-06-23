'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');

const db = require('./db');
const delivery = require('./delivery');

const app = express();
const PORT = process.env.PORT || 5094;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// Capture the raw body for inbound hooks (needed for HMAC verification) while
// still parsing JSON/urlencoded for the management UI.
app.use('/hooks', express.raw({ type: '*/*', limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function slugify(name) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return (base || 'hook') + '-' + crypto.randomBytes(3).toString('hex');
}

function baseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  const webhooks = db.prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all();
  const actions = db
    .prepare('SELECT a.*, w.name AS webhook_name FROM actions a JOIN webhooks w ON w.id = a.webhook_id ORDER BY a.created_at DESC')
    .all();
  const events = db
    .prepare('SELECT e.*, w.name AS webhook_name FROM events e JOIN webhooks w ON w.id = e.webhook_id ORDER BY e.received_at DESC LIMIT 25')
    .all();
  const deliveries = db
    .prepare(`
      SELECT d.*, a.name AS action_name, w.name AS webhook_name
        FROM deliveries d
        JOIN actions a ON a.id = d.action_id
        JOIN events  e ON e.id = d.event_id
        JOIN webhooks w ON w.id = e.webhook_id
       ORDER BY d.updated_at DESC
       LIMIT 25
    `)
    .all();

  const stats = {
    webhooks: webhooks.length,
    actions: actions.length,
    events: db.prepare('SELECT COUNT(*) c FROM events').get().c,
    pending: db.prepare("SELECT COUNT(*) c FROM deliveries WHERE status = 'pending'").get().c,
    failed: db.prepare("SELECT COUNT(*) c FROM deliveries WHERE status = 'failed'").get().c,
  };

  res.render('dashboard', { webhooks, actions, events, deliveries, stats, baseUrl: baseUrl(req) });
});

// Event detail (payload + its deliveries)
app.get('/events/:id', (req, res) => {
  const event = db
    .prepare('SELECT e.*, w.name AS webhook_name FROM events e JOIN webhooks w ON w.id = e.webhook_id WHERE e.id = ?')
    .get(req.params.id);
  if (!event) return res.status(404).send('Event not found');
  const deliveries = db
    .prepare('SELECT d.*, a.name AS action_name FROM deliveries d JOIN actions a ON a.id = d.action_id WHERE d.event_id = ? ORDER BY d.id')
    .all(event.id);
  res.render('event', { event, deliveries });
});

// ---------------------------------------------------------------------------
// Webhook management
// ---------------------------------------------------------------------------
app.post('/webhooks', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).send('Webhook name is required');
  const secret = (req.body.secret || '').trim() || null;
  db.prepare('INSERT INTO webhooks (name, slug, secret) VALUES (?, ?, ?)').run(name, slugify(name), secret);
  res.redirect('/');
});

app.post('/webhooks/:id/delete', (req, res) => {
  db.prepare('DELETE FROM webhooks WHERE id = ?').run(req.params.id);
  res.redirect('/');
});

// ---------------------------------------------------------------------------
// Action management
// ---------------------------------------------------------------------------
app.post('/actions', (req, res) => {
  const { name, webhook_id, target_url, method } = req.body;
  if (!name || !webhook_id || !target_url) {
    return res.status(400).send('name, webhook_id and target_url are required');
  }
  let headers_json = '{}';
  if (req.body.headers_json && req.body.headers_json.trim()) {
    try {
      JSON.parse(req.body.headers_json);
      headers_json = req.body.headers_json.trim();
    } catch (_) {
      return res.status(400).send('headers_json must be valid JSON');
    }
  }
  const maxAttempts = Math.max(1, parseInt(req.body.max_attempts, 10) || 5);
  db.prepare(`
    INSERT INTO actions (name, webhook_id, target_url, method, headers_json, max_attempts)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name.trim(), webhook_id, target_url.trim(), (method || 'POST').toUpperCase(), headers_json, maxAttempts);
  res.redirect('/');
});

app.post('/actions/:id/toggle', (req, res) => {
  db.prepare('UPDATE actions SET enabled = 1 - enabled WHERE id = ?').run(req.params.id);
  res.redirect('/');
});

app.post('/actions/:id/delete', (req, res) => {
  db.prepare('DELETE FROM actions WHERE id = ?').run(req.params.id);
  res.redirect('/');
});

// ---------------------------------------------------------------------------
// Retry a delivery
// ---------------------------------------------------------------------------
app.post('/deliveries/:id/retry', async (req, res) => {
  const d = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).send('Delivery not found');
  // Reset to pending and bump the attempt ceiling so a manual retry always runs.
  db.prepare(`
    UPDATE deliveries
       SET status = 'pending',
           max_attempts = MAX(max_attempts, attempts + 1),
           next_attempt_at = datetime('now'),
           updated_at = datetime('now')
     WHERE id = ?
  `).run(d.id);
  await delivery.attemptDelivery(d.id).catch((err) => console.error(err));
  res.redirect(req.get('referer') || '/');
});

// ---------------------------------------------------------------------------
// Inbound webhook receiver
// ---------------------------------------------------------------------------
app.all('/hooks/:slug', (req, res) => {
  const webhook = db.prepare('SELECT * FROM webhooks WHERE slug = ?').get(req.params.slug);
  if (!webhook) return res.status(404).json({ error: 'unknown webhook' });

  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';

  // Optional HMAC verification when the webhook was created with a secret.
  if (webhook.secret) {
    const provided = req.get('x-hub-signature-256') || '';
    const expected = 'sha256=' + crypto.createHmac('sha256', webhook.secret).update(rawBody).digest('hex');
    const ok =
      provided.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (!ok) return res.status(401).json({ error: 'invalid signature' });
  }

  const info = db
    .prepare('INSERT INTO events (webhook_id, payload, headers_json, source_ip) VALUES (?, ?, ?, ?)')
    .run(webhook.id, rawBody || '{}', JSON.stringify(req.headers), req.ip);

  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid);
  const deliveryIds = delivery.createDeliveriesForEvent(event);
  delivery.dispatch(deliveryIds);

  res.status(202).json({ accepted: true, event_id: event.id, deliveries: deliveryIds.length });
});

// ---------------------------------------------------------------------------
// Background retry worker
// ---------------------------------------------------------------------------
const RETRY_INTERVAL_MS = 5_000;
setInterval(() => {
  delivery.processDueRetries().catch((err) => console.error('retry worker:', err));
}, RETRY_INTERVAL_MS).unref();

app.listen(PORT, () => {
  console.log(`Integration hub running at http://localhost:${PORT}`);
});

module.exports = app;
