'use strict';

const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const {
  validateName,
  validateTargetUrl,
  validateMethod,
} = require('../lib/validate');

const router = express.Router();

const listWebhooks = db.prepare(
  'SELECT * FROM webhooks WHERE user_id = ? ORDER BY created_at DESC'
);
const insertWebhook = db.prepare(
  'INSERT INTO webhooks (user_id, name, token) VALUES (?, ?, ?)'
);
// All single-row lookups are scoped by user_id to prevent IDOR.
const getWebhook = db.prepare('SELECT * FROM webhooks WHERE id = ? AND user_id = ?');
const deleteWebhook = db.prepare('DELETE FROM webhooks WHERE id = ? AND user_id = ?');

const listActions = db.prepare(
  'SELECT * FROM actions WHERE webhook_id = ? AND user_id = ? ORDER BY created_at DESC'
);
const insertAction = db.prepare(`
  INSERT INTO actions (user_id, webhook_id, name, target_url, method)
  VALUES (@user_id, @webhook_id, @name, @target_url, @method)
`);
const getAction = db.prepare('SELECT * FROM actions WHERE id = ? AND user_id = ?');
const deleteAction = db.prepare('DELETE FROM actions WHERE id = ? AND user_id = ?');
const toggleAction = db.prepare(
  'UPDATE actions SET enabled = CASE enabled WHEN 1 THEN 0 ELSE 1 END WHERE id = ? AND user_id = ?'
);

function baseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

router.get('/webhooks', (req, res) => {
  const webhooks = listWebhooks.all(req.user.id);
  res.render('webhooks', { title: 'Webhooks', webhooks, error: null });
});

router.post('/webhooks', (req, res) => {
  const name = validateName(req.body.name, 'Webhook name');
  if (!name.ok) {
    const webhooks = listWebhooks.all(req.user.id);
    return res.status(400).render('webhooks', {
      title: 'Webhooks',
      webhooks,
      error: name.error,
    });
  }
  const token = crypto.randomBytes(24).toString('hex');
  insertWebhook.run(req.user.id, name.value, token);
  res.redirect('/webhooks');
});

router.get('/webhooks/:id', (req, res, next) => {
  const webhook = getWebhook.get(req.params.id, req.user.id);
  if (!webhook) return next(); // -> 404
  const actions = listActions.all(webhook.id, req.user.id);
  res.render('webhook_detail', {
    title: webhook.name,
    webhook,
    actions,
    inboundUrl: `${baseUrl(req)}/in/${webhook.token}`,
    error: null,
  });
});

router.post('/webhooks/:id/delete', (req, res, next) => {
  const info = deleteWebhook.run(req.params.id, req.user.id);
  if (info.changes === 0) return next(); // not owned / not found -> 404
  res.redirect('/webhooks');
});

router.post('/webhooks/:id/actions', (req, res, next) => {
  const webhook = getWebhook.get(req.params.id, req.user.id);
  if (!webhook) return next();

  const name = validateName(req.body.name, 'Action name');
  const url = validateTargetUrl(req.body.target_url);
  const method = validateMethod(req.body.method);

  const firstError =
    (!name.ok && name.error) || (!url.ok && url.error) || (!method.ok && method.error);

  if (firstError) {
    const actions = listActions.all(webhook.id, req.user.id);
    return res.status(400).render('webhook_detail', {
      title: webhook.name,
      webhook,
      actions,
      inboundUrl: `${baseUrl(req)}/in/${webhook.token}`,
      error: firstError,
    });
  }

  insertAction.run({
    user_id: req.user.id,
    webhook_id: webhook.id,
    name: name.value,
    target_url: url.value,
    method: method.value,
  });
  res.redirect(`/webhooks/${webhook.id}`);
});

router.post('/actions/:id/delete', (req, res, next) => {
  const action = getAction.get(req.params.id, req.user.id);
  if (!action) return next();
  deleteAction.run(action.id, req.user.id);
  res.redirect(`/webhooks/${action.webhook_id}`);
});

router.post('/actions/:id/toggle', (req, res, next) => {
  const action = getAction.get(req.params.id, req.user.id);
  if (!action) return next();
  toggleAction.run(action.id, req.user.id);
  res.redirect(`/webhooks/${action.webhook_id}`);
});

module.exports = router;
