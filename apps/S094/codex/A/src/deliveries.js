const { getDb } = require("./db");
const { assertPublicHttpUrl } = require("./security");

const MAX_RESPONSE_CHARS = 2000;

function clip(text) {
  if (!text) return "";
  return text.length > MAX_RESPONSE_CHARS ? `${text.slice(0, MAX_RESPONSE_CHARS)}...` : text;
}

async function deliver(eventId, actionId, attempt = 1) {
  const db = await getDb();
  const event = await db.get("SELECT * FROM events WHERE id = ?", eventId);
  const action = await db.get("SELECT * FROM actions WHERE id = ? AND is_active = 1", actionId);
  if (!event || !action) return null;

  const result = await db.run(
    "INSERT INTO deliveries (event_id, action_id, user_id, attempt, status) VALUES (?, ?, ?, ?, ?)",
    eventId,
    actionId,
    event.user_id,
    attempt,
    "pending"
  );
  const deliveryId = result.lastID;

  try {
    const url = await assertPublicHttpUrl(action.target_url);
    const eventBody = JSON.parse(event.body_json);
    const response = await fetch(url, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        "x-integration-hub-event": String(event.id),
        "x-integration-hub-action": String(action.id)
      },
      body: JSON.stringify({
        eventId: event.id,
        webhookId: event.webhook_id,
        actionId: action.id,
        receivedAt: event.created_at,
        method: event.method,
        payload: eventBody
      }),
      signal: AbortSignal.timeout(10000)
    });
    const responseBody = clip(await response.text());
    await db.run(
      `UPDATE deliveries
       SET status = ?, status_code = ?, response_body = ?, completed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      response.ok ? "success" : "failed",
      response.status,
      responseBody,
      deliveryId
    );
  } catch (error) {
    await db.run(
      `UPDATE deliveries
       SET status = 'failed', error = ?, completed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      clip(error.message || String(error)),
      deliveryId
    );
  }

  return db.get(
    `SELECT d.*, a.name AS action_name, a.target_url
     FROM deliveries d
     JOIN actions a ON a.id = d.action_id
     WHERE d.id = ?`,
    deliveryId
  );
}

async function deliverEvent(eventId) {
  const db = await getDb();
  const event = await db.get("SELECT * FROM events WHERE id = ?", eventId);
  if (!event) return [];

  const actions = await db.all(
    "SELECT * FROM actions WHERE webhook_id = ? AND user_id = ? AND is_active = 1 ORDER BY id",
    event.webhook_id,
    event.user_id
  );
  const results = [];
  for (const action of actions) {
    results.push(await deliver(event.id, action.id, 1));
  }
  return results;
}

async function retryDelivery(deliveryId, userId) {
  const db = await getDb();
  const previous = await db.get("SELECT * FROM deliveries WHERE id = ? AND user_id = ?", deliveryId, userId);
  if (!previous) return null;
  const lastAttempt = await db.get(
    "SELECT MAX(attempt) AS attempt FROM deliveries WHERE event_id = ? AND action_id = ?",
    previous.event_id,
    previous.action_id
  );
  return deliver(previous.event_id, previous.action_id, (lastAttempt.attempt || 1) + 1);
}

module.exports = { deliverEvent, retryDelivery };
