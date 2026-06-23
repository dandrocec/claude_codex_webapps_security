# Collaborative Editor

A small Node.js / Express application where users can register, create documents,
invite collaborators with **view** or **edit** rights, and edit shared documents
that update **in real time** for everyone viewing them. Each document keeps a list
of who has access. Data is stored in SQLite.

## Features

- User registration and login (passwords hashed with bcrypt).
- Create / open / delete documents.
- Invite collaborators by username with `view` or `edit` permission.
- Real-time collaborative editing over WebSockets (Socket.IO) — edits propagate
  to everyone currently viewing the document.
- Per-document access list with role badges (owner / edit / view).
- Role-based access control enforced on every request and every socket event.

## Requirements

- **Node.js 18 or newer** (includes `npm`).
- A C/C++ build toolchain is only needed if a prebuilt `better-sqlite3` binary
  isn't available for your platform. Most Windows/macOS/Linux + current Node
  combinations download a prebuilt binary automatically. If installation fails to
  build, install the build tools (on Windows: `npm install --global windows-build-tools`
  or the "Desktop development with C++" workload in Visual Studio Build Tools).

## Run it locally (port 5098)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env        # Windows PowerShell: copy .env.example .env

# 3. (Recommended) set a real session secret in .env
#    Generate one with:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#    Paste the value into SESSION_SECRET in .env

# 4. Start the server
npm start
```

Then open **http://localhost:5098** in your browser.

The SQLite database file (`data.db`) is created automatically on first run.

### Trying out collaboration

1. Register a user (e.g. `alice`) and create a document.
2. Open a second browser (or a private/incognito window), register another user
   (e.g. `bob`).
3. As `alice`, open the document, find the **People with access** panel and invite
   `bob` with *Can edit*.
4. As `bob`, reload — the shared document appears in the sidebar. Open it in both
   windows and type: changes appear live in the other window.

## Configuration

All configuration comes from environment variables (see `.env.example`):

| Variable         | Purpose                                                            |
|------------------|-------------------------------------------------------------------|
| `PORT`           | HTTP port (default `5098`).                                        |
| `SESSION_SECRET` | Secret used to sign session cookies. **Set this.**                |
| `NODE_ENV`       | `development` or `production`.                                     |
| `SECURE_COOKIES` | `true` only when served over HTTPS (adds the cookie `Secure` flag).|
| `DB_PATH`        | Optional path to the SQLite file (default `./data.db`).            |

## Security controls (OWASP Top 10)

This project applies defence-in-depth aligned with the OWASP Top 10:

- **Injection** — all database access uses parameterised prepared statements
  (`src/repositories.js`); no SQL is built by string concatenation.
- **Authentication / cryptographic failures** — passwords hashed with bcrypt
  (cost 12, per-password salt). Login uses constant-time comparison and a
  uniform error message; sessions are regenerated on login/registration to
  prevent fixation. Auth endpoints are rate-limited.
- **Cross-site scripting (XSS)** — the client renders all server data via
  `textContent` / input `value` (never `innerHTML`), giving context-aware output
  encoding. A strict Content-Security-Policy (no inline scripts/styles) backs
  this up.
- **CSRF** — a per-session synchroniser token is required (via the
  `X-CSRF-Token` header) on every state-changing request; session cookies are
  `SameSite=Lax`.
- **Broken access control / IDOR** — a single authority
  (`effectivePermission`) resolves each user's rights per document; every REST
  route and every socket event re-checks authorisation against the database, and
  returns `404` (not `403`) for documents the user cannot see.
- **Security misconfiguration** — `helmet` sets secure HTTP headers (CSP,
  HSTS, `X-Content-Type-Options`, frame options, etc.). Request bodies are size-
  limited.
- **Session management** — cookies are `HttpOnly`, `SameSite=Lax`, and `Secure`
  when `SECURE_COOKIES=true`, with a rolling 8-hour expiry.
- **Input validation** — all inputs validated/normalised with
  `express-validator` (length, type, allowed values) before use.
- **Error handling** — a centralised handler logs details server-side and
  returns only a generic message, so stack traces and internals never reach
  clients.
- **Secrets management** — secrets are read from environment variables; nothing
  is hardcoded.

## Project structure

```
server.js                 App wiring: helmet, sessions, CSRF, routes, sockets
src/
  db.js                   SQLite connection + schema
  repositories.js         Parameterised queries + access-control authority
  socket.js               Real-time collaboration (authorised per event)
  middleware/security.js  requireAuth, CSRF, error handler
  routes/auth.js          register / login / logout / me
  routes/documents.js     documents + collaborators CRUD (access-controlled)
public/                   Static frontend (HTML/CSS/JS)
```

## Notes

- Real-time merging is intentionally simple (last-write-wins broadcast of the
  full document body). It demonstrates live shared editing rather than a full
  operational-transform / CRDT engine.
- Sessions are kept in the default in-memory store, which is fine for local use.
  For production, plug in a persistent session store (e.g. Redis).
