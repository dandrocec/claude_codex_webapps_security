# URL Shortener

A small, security-hardened URL shortener built with Node.js + Express.

- Submit a long URL via a form and receive a short code.
- Visiting `/<code>` redirects (302) to the original URL.
- Mappings are stored **in memory** (no database).
- The home page lists the codes **you** created in the current session.

## Requirements

- Node.js >= 18

## Run locally (port 5009)

```bash
npm install
npm start
```

Then open <http://localhost:5009>.

The port defaults to **5009**. You can override it:

```bash
# macOS / Linux
PORT=5009 npm start

# Windows PowerShell
$env:PORT = "5009"; npm start
```

### Configuration (environment variables)

No secrets are hardcoded — they are read from the environment.

| Variable         | Default                         | Notes                                                                 |
| ---------------- | ------------------------------- | --------------------------------------------------------------------- |
| `PORT`           | `5009`                          | Port to listen on.                                                    |
| `SESSION_SECRET` | random ephemeral (dev only)     | Secret for signing session cookies. **Required** in production.       |
| `NODE_ENV`       | unset                           | Set to `production` to enable HSTS and `Secure` cookies (HTTPS only). |

In `production`, the app refuses to start without `SESSION_SECRET`.

```bash
# Example production-style run
SESSION_SECRET="$(openssl rand -hex 32)" NODE_ENV=production PORT=5009 npm start
```

> Note: `Secure` cookies require HTTPS. For production set `NODE_ENV=production`
> and terminate TLS in front of the app (the app trusts one proxy hop).

## Security measures

This app applies relevant OWASP Top 10 controls. Several Top-10 items
(SQL injection, password hashing, multi-user IDOR) do not have a direct surface
here because there is **no database and no user accounts** — the corresponding
principles are still honoured where they apply:

- **Injection / SQLi:** No SQL or any database is used, so there is no SQL
  injection surface. Data is kept in an in-memory `Map` keyed by generated
  codes (never by raw user input used in a query).
- **XSS:** All user-controlled output is rendered through EJS with
  context-aware HTML escaping (`<%= %>`). A strict Content-Security-Policy
  (`default-src 'self'`, no inline scripts/styles) provides defence in depth.
- **Input validation:** Submitted URLs are validated with the WHATWG `URL`
  parser and restricted to absolute `http:`/`https:` URLs, rejecting dangerous
  schemes such as `javascript:`, `data:`, and `file:`. Length is capped and the
  request body size is limited.
- **CSRF:** All state-changing requests (`POST /shorten`) require a valid
  per-session synchronizer token, compared in constant time. `SameSite=Strict`
  cookies add a second layer.
- **Secure session cookies:** `HttpOnly`, `SameSite=Strict`, and `Secure`
  (in production), with a bounded lifetime.
- **Access control / IDOR:** The list of created codes is scoped to the
  visitor's own session, so users cannot enumerate or view others' link lists.
  Code lookups use a strict `^[A-Za-z0-9]{7}$` pattern, preventing path abuse.
- **Security headers:** Set via Helmet (CSP, `X-Content-Type-Options`,
  `frameAncestors 'none'`, HSTS in production, etc.).
- **Error handling:** Errors are logged server-side only; clients receive
  generic messages with no stack traces or internal details.
- **Secrets management:** The session secret is read from `SESSION_SECRET`;
  nothing sensitive is hardcoded.
- **Rate limiting:** `POST /shorten` is rate-limited to reduce abuse.

## Project layout

```
.
├── server.js          # Express app, routes, security middleware
├── package.json
├── public/
│   └── styles.css     # Stylesheet (served as a static file; CSP-friendly)
├── views/
│   ├── index.ejs      # Form + session link list
│   └── error.ejs      # Generic error page
└── README.md
```
