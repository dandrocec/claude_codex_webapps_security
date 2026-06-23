'use strict';

const db = require('./db');

// Exponential backoff schedule (seconds) used to compute next_attempt_at.
const BACKOFF_SECONDS = [10, 30, 120, 300, 900];
const REQUEST_TIMEOUT_MS = 10_000;

function backoffSeconds(attempt) {
  // attempt is 1-based (the attempt that just failed)
  const idx = Math.min(attempt - 1, BACKOFF_SECONDS.length - 1);
  return BACKOFF_SECONDS[Math.max(0, idx)];
}

/**
 * Create one delivery row per enabled action attached to the event's webhook.
 * Returns the list of created delivery ids.
 */
function createDeliveriesForEvent(event) {
  const actions = db
    .prepare('SELECT * FROM actions WHERE webhook_id = ? AND enabled = 1')
    .all(event.webhook_id);

  const insert = db.prepare(`
    INSERT INTO deliveries (event_id, action_id, target_url, max_attempts, status, next_attempt_at)
    VALUES (@event_id, @action_id, @target_url, @max_attempts, 'pending', datetime('now'))
  `);

  const ids = [];
  const tx = db.transaction(() => {
    for (const action of actions) {
      const info = insert.run({
        event_id: event.id,
        action_id: action.id,
        target_url: action.target_url,
        max_attempts: action.max_attempts,
      });
      ids.push(info.lastInsertRowid);
    }
  });
  tx();
  return ids;
}

/**
 * Attempt a single delivery once. Updates the delivery row with the outcome
 * and schedules a retry (next_attempt_at) if it failed and attempts remain.
 */
async function attemptDelivery(deliveryId) {
  const delivery = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(deliveryId);
  if (!delivery || delivery.status === 'success') return delivery;

  const action = db.prepare('SELECT * FROM actions WHERE id = ?').get(delivery.action_id);
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(delivery.event_id);
  if (!action || !event) return delivery;

  const attempts = delivery.attempts + 1;
  let headers = {};
  try {
    headers = JSON.parse(action.headers_json || '{}');
  } catch (_) {
    headers = {};
  }
  headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  headers['X-Hub-Event-Id'] = String(event.id);
  headers['X-Hub-Delivery-Id'] = String(delivery.id);
  headers['X-Hub-Attempt'] = String(attempts);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let status = null;
  let error = null;
  let body = null;

  try {
    const res = await fetch(action.target_url, {
      method: action.method || 'POST',
      headers,
      body: event.payload,
      signal: controller.signal,
    });
    status = res.status;
    body = (await res.text()).slice(0, 4000);
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (err) {
    error = err.name === 'AbortError' ? `Timed out after ${REQUEST_TIMEOUT_MS}ms` : String(err.message || err);
  } finally {
    clearTimeout(timer);
  }

  const succeeded = status !== null && status >= 200 && status < 300;
  let newStatus;
  let nextAttemptAt = null;

  if (succeeded) {
    newStatus = 'success';
  } else if (attempts >= delivery.max_attempts) {
    newStatus = 'failed';
  } else {
    newStatus = 'pending';
    nextAttemptAt = `+${backoffSeconds(attempts)} seconds`;
  }

  db.prepare(`
    UPDATE deliveries
       SET status = ?,
           attempts = ?,
           last_status = ?,
           last_error = ?,
           response_body = ?,
           next_attempt_at = CASE WHEN ? IS NULL THEN NULL ELSE datetime('now', ?) END,
           updated_at = datetime('now')
     WHERE id = ?
  `).run(newStatus, attempts, status, error, body, nextAttemptAt, nextAttemptAt, deliveryId);

  return db.prepare('SELECT * FROM deliveries WHERE id = ?').get(deliveryId);
}

/**
 * Fire-and-forget: kick off the first attempt for a set of deliveries.
 * Failures are recorded in the DB, so we just log unexpected errors.
 */
function dispatch(deliveryIds) {
  for (const id of deliveryIds) {
    attemptDelivery(id).catch((err) => console.error(`delivery ${id} crashed:`, err));
  }
}

/**
 * Background worker: pick up pending deliveries whose next_attempt_at is due
 * and retry them. Runs on an interval from server.js.
 */
async function processDueRetries() {
  const due = db
    .prepare(`
      SELECT id FROM deliveries
       WHERE status = 'pending'
         AND next_attempt_at IS NOT NULL
         AND next_attempt_at <= datetime('now')
       ORDER BY next_attempt_at ASC
       LIMIT 20
    `)
    .all();

  for (const row of due) {
    await attemptDelivery(row.id).catch((err) => console.error(`retry ${row.id} crashed:`, err));
  }
  return due.length;
}

module.exports = {
  createDeliveriesForEvent,
  attemptDelivery,
  dispatch,
  processDueRetries,
};
