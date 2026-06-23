# Integration Hub

A small but complete integration hub built with **Node.js + Express**. It lets you:

- **Register inbound webhooks** — each gets a unique URL that external services POST to.
- **Define outbound actions** — when an event arrives on a webhook, the hub forwards the
  payload to any user-supplied URL you've attached to that webhook.
- **Watch a dashboard** of recent events and deliveries, with delivery status, attempt
  counts, response codes, and a **Retry** button.
- **Automatic retries** with exponential backoff for failed deliveries.

Configuration (webhooks, actions) and logs (events, deliveries) are stored in a local
**SQLite** database (`data/hub.db`) — no external database to set up.

## Requirements

- Node.js **18 or newer** (uses the built-in `fetch`).

## Run it locally on port 5094

```bash
npm install
npm start
```

Then open <http://localhost:5094>.

> The port defaults to **5094**. Override with `PORT=xxxx npm start` if needed.

## How it works

```
  external service ──POST──▶  /hooks/:slug  ──▶  event stored
                                                   │
                                                   ▼
                                    one delivery per enabled action
                                                   │
                                       POST/PUT/PATCH to target_url
                                                   │
                                  success ◀──┴──▶ retry w/ backoff
```

1. **Create a webhook** on the dashboard. You get an inbound URL like
   `http://localhost:5094/hooks/github-push-1a2b3c`.
2. **Create an action** pointing at it, with the target URL you want called (plus optional
   method and extra headers as JSON).
3. **Send an event** to the inbound URL. The hub records it and fires every enabled action
   attached to that webhook.

### Try it from the command line

Grab the inbound URL from the dashboard, then:

```bash
curl -X POST http://localhost:5094/hooks/<your-slug> \
  -H "Content-Type: application/json" \
  -d '{"hello":"world"}'
```

You'll get back `{"accepted":true,"event_id":1,"deliveries":1}` and the event/delivery
will appear on the dashboard.

### Optional signature verification

If you set a **shared secret** when creating a webhook, inbound requests must include an
`X-Hub-Signature-256` header:

```
X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body using the secret>
```

Requests with a missing or invalid signature are rejected with `401`.

When the hub calls your outbound target it adds these headers so you can correlate:

- `X-Hub-Event-Id`, `X-Hub-Delivery-Id`, `X-Hub-Attempt`

## Retries

A failed delivery (non-2xx response, timeout, or network error) is retried in the
background with an exponential backoff schedule (10s, 30s, 2m, 5m, 15m) up to the action's
**max attempts**. You can also retry any delivery manually from the dashboard or an event's
detail page — a manual retry always runs once even if the attempt ceiling was reached.

## Project layout

```
src/
  server.js     Express app, routes, inbound receiver, retry worker
  db.js         SQLite schema and connection
  delivery.js   Delivery creation, HTTP attempt, backoff, retry worker
views/          EJS templates for the dashboard and event detail
data/hub.db     SQLite database (created on first run)
```

## Reset

Stop the server and delete the `data/` directory to wipe all webhooks, actions, and logs.
