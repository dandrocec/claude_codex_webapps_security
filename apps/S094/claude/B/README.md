# Integration Hub

A small Node.js/Express integration hub. Users register **inbound webhooks**
(each gets a unique secret URL), define **outbound actions** (call a user-supplied
URL when an event arrives), and watch a **dashboard** of recent events and
deliveries with a one-click **retry**. Configuration and logs are stored in a
SQLite database.

## Features

- Email/password accounts (passwords hashed with bcrypt).
- Inbound webhook endpoints authenticated by a per-webhook secret token.
- Outbound actions that forward the received payload to an external URL.
- Dashboard of recent events and deliveries; retry failed deliveries.
- SQLite persistence for users, webhooks, actions, events and deliveries.

## Requirements

- Node.js **18.17+** (uses the built-in `fetch`-free `http`/`https` stack and modern APIs).
- npm.

> `better-sqlite3` ships prebuilt binaries for common platforms. If your platform
> needs to compile it, you will also need build tools (on Windows, the
> "Desktop development with C++" workload, or `npm i -g windows-build-tools` on
> older setups).

## Run locally on port 5094

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env

# 3. (recommended) set a stable session secret in .env
#    SESSION_SECRET=<paste output of the command below>
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 4. Start
npm start
```

Then open <http://localhost:5094>, register an account, and create a webhook.

The default port is **5094** (override with `PORT` in `.env`).

## Try it end to end

1. Register and log in.
2. Create a webhook (e.g. "Test hook"). Open it to see its inbound URL:
   `http://localhost:5094/in/<token>`.
3. Add an outbound action pointing at a URL you control (for testing you can use
   a public request-bin style service, e.g. `https://webhook.site/...`).
4. Send an event to the inbound URL:

   ```bash
   curl -X POST http://localhost:5094/in/<token> \
     -H "Content-Type: application/json" \
     -d '{"hello":"world"}'
   ```

5. Watch the **Dashboard** — the event and its delivery (with HTTP status) appear.
   Use **Retry** to re-attempt a delivery.

## Configuration (environment variables)

See `.env.example`. Key settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `5094` | Listen port. |
| `SESSION_SECRET` | _(ephemeral in dev)_ | Signs session cookies. **Required in production.** |
| `COOKIE_SECURE` | `false` | Set `true` when served over HTTPS so cookies are `Secure`. |
| `NODE_ENV` | `development` | `production` enables stricter behaviour. |
| `DB_PATH` | `./data/hub.db` | SQLite file location. |
| `OUTBOUND_TIMEOUT_MS` | `5000` | Connection/read timeout for outbound deliveries. |
| `OUTBOUND_MAX_BYTES` | `65536` | Max outbound response body bytes read/stored. |
| `ALLOW_PRIVATE_TARGETS` | `false` | **Leave false.** Only for isolated local testing of the SSRF guard. |

## Security notes

This app applies OWASP Top 10 practices throughout:

- **SQL injection** — all database access uses parameterised prepared statements
  (`better-sqlite3`).
- **Passwords** — hashed with bcrypt (cost 12) and a per-hash salt; never stored
  in plaintext.
- **Input validation & output encoding** — all user input is validated/normalised
  server-side; all output is rendered through EJS auto-escaping (`<%= %>`), and a
  strict Content-Security-Policy forbids inline scripts/styles (XSS defence in depth).
- **CSRF** — every state-changing request requires a per-session synchroniser
  token (constant-time compared). The inbound ingress endpoint is exempt because
  it is machine-to-machine and authenticated by a secret token, not a session.
- **Access control / IDOR** — every query for a user-owned resource is scoped by
  the authenticated `user_id`; you can only see and act on your own resources.
- **Session cookies** — `HttpOnly`, `SameSite=Lax`, and `Secure` (when
  `COOKIE_SECURE=true`); the session id is regenerated on login/registration.
- **Security headers** — set via Helmet (CSP, HSTS when on HTTPS, no sniffing,
  frame denial, etc.). `X-Powered-By` is disabled.
- **Error handling** — a central handler logs full details server-side and returns
  only generic messages to clients (no stack traces or internals leak).
- **Secrets** — read from environment variables; nothing sensitive is hardcoded.
- **Rate limiting** — basic limits on both the app and the inbound endpoint.

### SSRF protection (outbound deliveries)

Outbound action requests go through a hardened client (`src/lib/ssrf.js` +
`src/lib/delivery.js`):

- **Scheme allow-list** — only `http`/`https`.
- **Host validation at connect time** — the DNS lookup used by the socket
  resolves the hostname and **rejects any address** in private, loopback,
  link-local, CGNAT, multicast or reserved ranges, including
  `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`,
  `169.254.0.0/16` (and `169.254.169.254`), `::1`, and `fc00::/7`. IPv4-mapped
  IPv6 addresses are unwrapped and re-checked. Validating inside the socket
  lookup also defeats **DNS rebinding**.
- **Cloud metadata** endpoints are explicitly blocked.
- **Timeouts** — connection and read timeouts (`OUTBOUND_TIMEOUT_MS`).
- **Max response size** — bodies larger than `OUTBOUND_MAX_BYTES` are truncated.
- **Redirects are not followed**, so a response cannot bounce the request to a
  disallowed internal target.

## Project layout

```
src/
  app.js            Express app wiring (security middleware, routes)
  server.js         HTTP server bootstrap
  config.js         Environment-driven configuration
  db.js             SQLite schema + connection
  middleware/       auth, CSRF, error handling
  lib/              ssrf guard, outbound delivery, input validation
  services/         dispatcher (event -> deliveries)
  routes/           auth, webhooks/actions, dashboard, inbound ingress
  views/            EJS templates (auto-escaped)
public/             static CSS
```

## Notes & limitations

- Sessions use the default in-memory store (fine for local/single-process use;
  use a shared store such as Redis for multi-instance production).
- Deliveries are attempted inline when an event arrives and on manual retry;
  there is no automatic background retry queue.
