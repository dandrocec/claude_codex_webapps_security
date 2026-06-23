# DevOps Dashboard

A small Express + SQLite dashboard for operating services. Operators register
services, trigger deployments that run a list of shell steps, watch logs stream
live (and persisted to the database), and manage encrypted per-service
environment secrets. Two roles are supported: **viewer** (read-only) and
**operator** (full control).

## Features

- **Service registry** — name, description, repo URL, and an ordered list of
  shell steps. Stored in SQLite.
- **Deployments** — run a service's steps sequentially on the host. Each step's
  stdout/stderr is captured, persisted, and broadcast live.
- **Log streaming + storage** — logs are written to the database row-by-row and
  streamed to the browser over Server-Sent Events (history is replayed on
  connect, so refreshing mid-deploy still works).
- **Secrets** — per-service key/value secrets, encrypted at rest with
  AES-256-GCM and injected as environment variables when a deployment runs.
  Values are never returned to the browser.
- **Roles & auth** — session-based login. `viewer` can read everything;
  `operator` can create/edit/delete services, manage secrets, and deploy.

## Requirements

- Node.js 18+ (uses the built-in `crypto` GCM API and modern Express).

## Run it locally (port 5100)

```bash
npm install
npm start
```

Then open http://localhost:5100.

The database, encryption key, and session store are created automatically under
`./data/` on first launch, along with two seeded accounts and a `demo-service`:

| Username   | Password      | Role     |
|------------|---------------|----------|
| `operator` | `operator123` | operator |
| `viewer`   | `viewer123`   | viewer   |

> Change the port with `PORT=8080 npm start` (or `set PORT=8080` then
> `npm start` on Windows). The default is **5100**.

### Try it

1. Sign in as `operator / operator123`.
2. Select **demo-service** and click **Deploy now** — watch the steps stream in
   the log panel.
3. Add a secret (e.g. `API_TOKEN`) and a service whose step echoes it
   (`echo $API_TOKEN` on POSIX, `echo %API_TOKEN%` on Windows cmd) to see it
   injected.
4. Log out and sign in as `viewer / viewer123` — deploy/edit/secret controls
   disappear and the corresponding API calls return `403`.

## Configuration

All optional — sensible defaults are used so the app runs with zero config.

| Variable         | Default                              | Purpose                                        |
|------------------|--------------------------------------|------------------------------------------------|
| `PORT`           | `5100`                               | HTTP port.                                     |
| `SECRET_KEY`     | generated → `data/secret.key`        | 32-byte AES key (hex or base64) for secrets.   |
| `SESSION_SECRET` | dev default                          | express-session signing secret.                |

For any real use, set `SECRET_KEY` and `SESSION_SECRET` yourself.

## Project layout

```
server.js              Express app: routes for auth, services, secrets, deployments, SSE
src/db.js              SQLite connection + schema
src/auth.js            Password hashing, login, role middleware
src/crypto.js          AES-256-GCM encrypt/decrypt for secrets
src/runner.js          Deployment executor: runs steps, stores + streams logs
scripts/seed.js        Seeds default users and a demo service
public/                Single-page frontend (HTML/CSS/vanilla JS)
data/                  SQLite DB, key, sessions (created at runtime, git-ignored)
```

## API overview

| Method & path                                  | Role     | Description                         |
|------------------------------------------------|----------|-------------------------------------|
| `POST /api/login` / `POST /api/logout`         | any      | Session auth.                       |
| `GET  /api/services`                           | viewer+  | List services.                     |
| `POST /api/services`                           | operator | Create a service.                  |
| `PUT/DELETE /api/services/:id`                 | operator | Update / delete a service.         |
| `GET  /api/services/:id/secrets`               | viewer+  | List secret keys (no values).      |
| `PUT/DELETE /api/services/:id/secrets/:key`    | operator | Set / remove a secret.             |
| `POST /api/services/:id/deploy`                | operator | Trigger a deployment.              |
| `GET  /api/deployments/:id/logs`               | viewer+  | Stored logs (JSON).                |
| `GET  /api/deployments/:id/stream`             | viewer+  | Live log stream (SSE).             |

## Security notes

Running deployment steps **executes arbitrary shell commands on the host** —
that is the purpose of the tool. Only grant the `operator` role to trusted
users and run the dashboard in an environment where that is acceptable (e.g. an
isolated deploy host or container). Secrets are encrypted at rest but are
decrypted into the deployment's environment at run time.
