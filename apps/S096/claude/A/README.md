# API Gateway

A small but complete API gateway built with Node.js + Express.

- **Developers register** and **generate API keys** (keys are hashed at rest;
  the raw key is shown exactly once).
- **Incoming requests with a valid key are proxied** to a configured backend
  under `/gateway/*`.
- **Per-key rate limiting** (sliding 1-minute window) and **usage tracking**.
- A **web dashboard** shows keys, live usage, rate-limit headroom, and a recent
  request log.
- Keys and usage are stored in a **SQLite database** (via Node's built-in
  `node:sqlite` — no native build step, no external DB server).

## Requirements

- **Node.js ≥ 22.5** (the project is developed/tested on Node 24).
  The built-in `node:sqlite` module is what makes storage zero-config.

## Run it locally (port 5096)

```bash
npm install
npm start
```

Then open the dashboard: **http://localhost:5096/**

The server listens on port **5096** by default. To change it:

```bash
# macOS/Linux
PORT=5096 npm start

# Windows PowerShell
$env:PORT=5096; npm start
```

Configuration is optional — everything has working defaults. To override via a
file, copy `.env.example` to `.env` and start with:

```bash
node --env-file=.env src/server.js
```

| Variable      | Default                                  | Meaning                                  |
| ------------- | ---------------------------------------- | ---------------------------------------- |
| `PORT`        | `5096`                                   | Port the gateway listens on              |
| `BACKEND_URL` | `https://jsonplaceholder.typicode.com`   | Backend that `/gateway/*` is proxied to  |
| `DB_PATH`     | `./data/gateway.db`                      | SQLite database file location            |

## Using it

### Via the dashboard

1. Open http://localhost:5096/
2. **Register a developer** (name + email) → you get a developer ID.
3. **Generate an API key** (optionally set a label and rate limit).
   Copy the key — it is shown only once.
4. Watch usage update live as you send requests through the gateway.

### Via the API (curl)

```bash
# 1. Register a developer
curl -s -X POST http://localhost:5096/register \
  -H 'content-type: application/json' \
  -d '{"name":"Ada Lovelace","email":"ada@example.com"}'
# -> { "id": 1, ... }

# 2. Generate an API key (60 requests/min)
curl -s -X POST http://localhost:5096/developers/1/keys \
  -H 'content-type: application/json' \
  -d '{"label":"production","rate_limit":60}'
# -> { "api_key": "gw_xx…", ... }   (shown once!)

# 3. Make a proxied request through the gateway
curl -s http://localhost:5096/gateway/todos/1 \
  -H 'x-api-key: gw_xx…'
# -> proxied JSON from the backend, with X-RateLimit-* headers

# 4. View usage
curl -s http://localhost:5096/developers/1/usage
```

The API key may be sent either as the `x-api-key` header or a `?api_key=` query
parameter.

## How the gateway maps URLs

A request to:

```
GET /gateway/todos/1   ->   GET {BACKEND_URL}/todos/1
```

Everything after `/gateway/` (path + query string) is forwarded to the backend.
The method, body, and most headers are passed through; the response status,
content-type, and body are returned to the caller.

## Endpoints

| Method   | Path                                    | Description                                  |
| -------- | --------------------------------------- | -------------------------------------------- |
| `POST`   | `/register`                             | Register a developer (`name`, `email`)       |
| `POST`   | `/developers/:id/keys`                  | Generate an API key (`label`, `rate_limit`)  |
| `GET`    | `/developers/:id/keys`                  | List a developer's keys (no secrets)         |
| `DELETE` | `/developers/:id/keys/:keyId`           | Revoke a key                                 |
| `GET`    | `/developers/:id/usage`                 | Usage summary + recent requests (dashboard)  |
| `ALL`    | `/gateway/*`                            | Authenticated, rate-limited proxy to backend |
| `GET`    | `/health`                               | Health check                                 |
| `GET`    | `/`                                     | Dashboard UI                                 |

## Rate limiting

Each key has a `rate_limit` (requests per minute, default 60). The gateway
counts a key's successful proxied requests over the trailing 60 seconds; once
the limit is reached, further requests get **HTTP 429** until the window clears.
Responses include `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers.
Throttled attempts are recorded too, so they show up in the dashboard.

## Project layout

```
src/
  server.js   Express app: routes, proxy, rate limiting
  db.js       SQLite schema + connection (node:sqlite)
  keys.js     API key generation / hashing
public/
  index.html  Dashboard (single-file, no build step)
data/
  gateway.db  Created on first run
```

## Security notes

This is a self-contained reference implementation. For production you would add:
authentication on the management/dashboard endpoints, TLS, persistent secrets,
and a distributed store (e.g. Redis) for rate-limit counters across instances.
API keys are stored as SHA-256 hashes, so the database never holds usable keys.
