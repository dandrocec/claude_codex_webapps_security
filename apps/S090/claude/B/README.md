# OAuth Secure App

A small **Node.js / Express** application where users sign in with a third-party
OAuth provider (**GitHub**). After login it stores a basic profile, shows a
personalised dashboard, and calls the GitHub API on the user's behalf to display
their most recent repositories. **Sessions and profiles are persisted in a
SQLite database.**

The app is written to follow **OWASP Top 10** best practices throughout — see
[Security](#security) below.

---

## Requirements

- **Node.js >= 18.17** (uses the built-in `fetch`)
- A GitHub account (to create a free OAuth app)

> `better-sqlite3` is a native module and compiles on install. On Windows you may
> need the build tools that ship with a standard Node.js installer ("Tools for
> Native Modules" checkbox), or run `npm install --global windows-build-tools`.

---

## 1. Create a GitHub OAuth App

Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
(<https://github.com/settings/developers>) and set:

| Field | Value |
| --- | --- |
| Application name | anything, e.g. `oauth-secure-app` |
| Homepage URL | `http://localhost:5090` |
| Authorization callback URL | `http://localhost:5090/auth/github/callback` |

Copy the **Client ID** and generate a **Client Secret**.

## 2. Configure environment

```bash
cp .env.example .env
```

Fill in `.env`. Generate the two secrets with:

```bash
# SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# ENCRYPTION_KEY (must be 64 hex chars / 32 bytes)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the GitHub `Client ID` / `Client Secret` into `GITHUB_CLIENT_ID` and
`GITHUB_CLIENT_SECRET`. The app **will not start** if a required secret is
missing or too weak — secrets are read only from the environment, never
hardcoded.

## 3. Install & run

```bash
npm install
npm start
```

Open <http://localhost:5090> and click **Sign in with GitHub**.

The SQLite database files are created automatically under `data/`
(`app.db` for profiles, `sessions.db` for sessions).

---

## How it works

| Route | Purpose |
| --- | --- |
| `GET /` | Landing page with the "Sign in with GitHub" button |
| `GET /auth/github` | Starts the OAuth flow (Passport adds an anti-CSRF `state`) |
| `GET /auth/github/callback` | OAuth callback; upserts the profile, regenerates the session |
| `GET /dashboard` | Personalised page; calls the GitHub API for the user's repos |
| `GET /users/:id/profile` | Returns **only the signed-in user's** stored profile as JSON |
| `POST /logout` | CSRF-protected logout |

---

## Security

A note on passwords: authentication is **fully delegated to the OAuth
provider**, so this app stores **no passwords at all** — there is nothing to
hash. The equivalent strong-crypto control that *is* relevant here is applied:
the provider **access token is encrypted at rest with AES-256-GCM**
(`src/crypto.js`) using a key supplied only via the environment.

Mapped to the OWASP Top 10:

- **A01 Broken Access Control / IDOR** — every authenticated route derives the
  user identity from the session, never from request input. `/users/:id/profile`
  additionally rejects any `id` that is not the current user (`requireSelf`).
- **A02 Cryptographic Failures** — access tokens encrypted with AES-256-GCM;
  session cookie signed with a strong secret; cookies are `HttpOnly`, `SameSite=Lax`,
  and `Secure` (auto-enabled in production / via `COOKIE_SECURE`).
- **A03 Injection (SQL & XSS)** — all DB access uses **parameterised** prepared
  statements (`src/db.js`); EJS `<%= %>` provides **context-aware HTML output
  encoding**; API responses are reduced to primitive, validated fields before
  rendering.
- **A04 Insecure Design** — minimal OAuth scopes, fail-closed config validation,
  session regeneration on login (prevents fixation), request body size limits.
- **A05 Security Misconfiguration** — `helmet` sets a strict **Content Security
  Policy** and security headers (`X-Content-Type-Options`, `Referrer-Policy`,
  `frameAncestors 'none'`, HSTS in production). The framework cookie name is
  generic (`sid`).
- **A07 Identification & Authentication Failures** — OAuth `state` parameter,
  rate limiting on auth routes, short-lived rolling sessions.
- **CSRF** — synchronizer-token pattern: a per-session token is embedded in every
  form and verified in constant time on all state-changing requests
  (`src/middleware.js`), backed by `SameSite=Lax` cookies.
- **A09 Logging / error handling** — a central error handler logs full details
  server-side but returns only generic messages; **no stack traces or internal
  errors leak to clients**.

### Production notes

- Serve over HTTPS and set `NODE_ENV=production` (forces `Secure` cookies + HSTS).
- Keep `.env` out of version control (already in `.gitignore`).
- Rotate `SESSION_SECRET` / `ENCRYPTION_KEY` if they may have been exposed.

---

## Project layout

```
src/
  server.js      app wiring: helmet, sessions, rate limiting, error handler
  config.js      env-var loading + validation (fails closed)
  crypto.js      AES-256-GCM encrypt/decrypt for tokens at rest
  db.js          SQLite + parameterised prepared statements
  auth.js        Passport GitHub OAuth strategy
  middleware.js  CSRF, auth guards, anti-IDOR helper
  routes.js      routes + GitHub API call on the user's behalf
  views/         EJS templates (auto-escaping output)
public/
  styles.css
```
