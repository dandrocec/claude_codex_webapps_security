'use strict';

const express = require('express');
const db = require('../db');
const { attemptDelivery } = require('../services/dispatcher');

const router = express.Router();

const recentEvents = db.prepare(`
  SELECT e.id, e.source_ip, e.created_at, w.name AS webhook_name
  FROM events e
  JOIN webhooks w ON w.id = e.webhook_id
  WHERE e.user_id = ?
  ORDER BY e.created_at DESC, e.id DESC
  LIMIT 50
`);

const recentDeliveries = db.prepare(`
  SELECT d.id, d.status, d.attempts, d.request_url, d.response_status,
         d.error, d.created_at, d.updated_at,
         a.name AS action_name, d.event_id
  FROM deliveries d
  JOIN actions a ON a.id = d.action_id
  WHERE d.user_id = ?
  ORDER BY d.updated_at DESC, d.id DESC
  LIMIT 50
`);

// Ownership-scoped: a user can only retry their own deliveries (IDOR guard).
const getOwnedDelivery = db.prepare(
  'SELECT id FROM deliveries WHERE id = ? AND user_id = ?'
);

router.get('/dashboard', (req, res) => {
  const events = recentEvents.all(req.user.id);
  const deliveries = recentDeliveries.all(req.user.id);
  res.render('dashboard', { title: 'Dashboard', events, deliveries });
});

router.post('/deliveries/:id/retry', async (req, res, next) => {
  try {
    const owned = getOwnedDelivery.get(req.params.id, req.user.id);
    if (!owned) return next(); // -> 404, never act on another user's delivery
    await attemptDelivery(owned.id);
    res.redirect('/dashboard');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
