'use strict';

const db = require('../db');
const { performRequest } = require('../lib/delivery');

const insertDelivery = db.prepare(`
  INSERT INTO deliveries (event_id, action_id, user_id, status, request_url)
  VALUES (@event_id, @action_id, @user_id, 'pending', @request_url)
`);

const getEnabledActions = db.prepare(
  'SELECT * FROM actions WHERE webhook_id = ? AND enabled = 1'
);

const updateDelivery = db.prepare(`
  UPDATE deliveries
  SET status = @status,
      attempts = attempts + 1,
      response_status = @response_status,
      response_body = @response_body,
      error = @error,
      updated_at = datetime('now')
  WHERE id = @id
`);

const getDeliveryWithAction = db.prepare(`
  SELECT d.*, a.target_url AS action_target_url, a.method AS action_method,
         e.payload AS event_payload
  FROM deliveries d
  JOIN actions a ON a.id = d.action_id
  JOIN events e ON e.id = d.event_id
  WHERE d.id = ?
`);

// Attempt a single delivery row and persist the outcome.
async function attemptDelivery(deliveryId) {
  const row = getDeliveryWithAction.get(deliveryId);
  if (!row) return;

  const result = await performRequest(row.action_target_url, {
    method: row.action_method,
    body: row.event_payload || '',
    headers: { 'X-Hub-Delivery': String(row.id) },
  });

  updateDelivery.run({
    id: row.id,
    status: result.ok ? 'success' : 'failed',
    response_status: result.status,
    response_body: result.body ? result.body.slice(0, 4000) : null,
    error: result.error || null,
  });
}

// Called when an inbound event arrives: create a delivery per enabled action,
// then attempt each. Returns the created delivery ids.
async function dispatchEvent(event) {
  const actions = getEnabledActions.all(event.webhook_id);
  const ids = [];

  const createAll = db.transaction(() => {
    for (const action of actions) {
      const info = insertDelivery.run({
        event_id: event.id,
        action_id: action.id,
        user_id: event.user_id,
        request_url: action.target_url,
      });
      ids.push(info.lastInsertRowid);
    }
  });
  createAll();

  // Fire attempts concurrently but don't reject the caller on failures.
  await Promise.allSettled(ids.map((id) => attemptDelivery(id)));
  return ids;
}

module.exports = { dispatchEvent, attemptDelivery };
