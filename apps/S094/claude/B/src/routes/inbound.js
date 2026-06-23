'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { dispatchEvent } = require('../services/dispatcher');

const router = express.Router();

const getWebhookByToken = db.prepare('SELECT * FROM webhooks WHERE token = ?');
const insertEvent = db.prepare(`
  INSERT INTO events (webhook_id, user_id, source_ip, payload)
  VALUES (@webhook_id, @user_id, @source_ip, @payload)
`);

// Limit abuse of the public ingress endpoint.
const inboundLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

// Accept any content type, cap the body size. Stored as text.
const captureBody = express.raw({ type: () => true, limit: '256kb' });

router.post('/in/:token', inboundLimiter, captureBody, async (req, res, next) => {
  try {
    const token = String(req.params.token || '');
    // Token format guard before touching the DB.
    if (!/^[a-f0-9]{48}$/.test(token)) {
      return res.status(404).json({ error: 'Unknown webhook.' });
    }
    const webhook = getWebhookByToken.get(token);
    if (!webhook) {
      return res.status(404).json({ error: 'Unknown webhook.' });
    }

    const payload = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';

    const info = insertEvent.run({
      webhook_id: webhook.id,
      user_id: webhook.user_id,
      source_ip: req.ip,
      payload,
    });

    const event = {
      id: info.lastInsertRowid,
      webhook_id: webhook.id,
      user_id: webhook.user_id,
    };

    // Fire deliveries; respond promptly with an accepted status.
    dispatchEvent(event).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[dispatch] failed for event', event.id, err);
    });

    return res.status(202).json({ accepted: true, event_id: event.id });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
