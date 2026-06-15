# Hex Palette Generator

A small Node.js / Express web app. Enter a base hex colour and it generates a
palette of five related shades, showing each swatch with its hex value.

## Requirements

- Node.js 18 or newer (tested on Node 24)
- npm

## Run locally (port 5007)

```bash
# 1. Install dependencies
npm install

# 2. (Optional) create a .env file
cp .env.example .env   # on Windows PowerShell: Copy-Item .env.example .env

# 3. Start the server
npm start
```

Then open <http://localhost:5007>.

The default port is **5007**. Override it with the `PORT` environment variable
(or in `.env`).

### Try it

Enter something like `#3366ff`, `#36f`, or `e91e63` and submit. The app shows
five shades from darkest to lightest, each labelled with its hex code.

## Project layout

```
server.js          Express app: routing, security middleware, error handling
lib/palette.js     Pure colour logic: hex validation + shade generation
views/index.ejs    Form + results (auto-escaped EJS templating)
views/error.ejs    Safe, generic error page
public/styles.css  Stylesheet
.env.example       Sample environment configuration
```

## Security notes (OWASP Top 10)

This app is deliberately stateless (no database, no user accounts), so a few of
the requested controls do not have a surface to apply to. Here is how each
requirement is handled:

| Requirement | How it's addressed |
| --- | --- |
| **Input validation & sanitisation** | The hex code is validated against a strict regex and normalised to canonical `#rrggbb` in `lib/palette.js`; anything else is rejected. Request body size is capped at 10 kB. |
| **Output encoding / XSS** | All dynamic values are rendered through EJS `<%= %>`, which HTML-escapes by default. A strict Content-Security-Policy (no inline scripts; styles via `'self'` + per-request nonce) provides defence in depth. |
| **CSRF protection** | Every state-changing `POST` requires a per-session synchronizer token (hidden `_csrf` field), verified in constant time. Cookies are also `SameSite=Lax`. |
| **Secure session cookies** | Session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production (`NODE_ENV=production`, behind a TLS-terminating proxy with `trust proxy`). |
| **Security headers** | Set via [helmet](https://helmetjs.github.io/): CSP, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, frame-ancestors `none`, etc. |
| **Error handling** | A central error handler logs details server-side and returns only generic, safe messages — no stack traces or internals reach the client. |
| **No hardcoded secrets** | `SESSION_SECRET` is read from the environment and is **required** in production (the process exits if missing). Dev uses an ephemeral random secret. |
| **Access control (IDOR)** | There are no per-user resources to access; nothing is keyed by a user-supplied identifier. |
| **SQL injection** | No database is used, so there are no queries. If one were added, use parameterised queries. |
| **Password hashing** | No authentication/credentials are stored. If added, hash with bcrypt or Argon2 (salted). |
| **Rate limiting** | The `/palette` endpoint is rate-limited (60 requests/min/IP) via `express-rate-limit`. |

> Because the brief mandated SQL-injection, password-hashing, and IDOR controls
> but the core feature needs neither a database nor accounts, those rows
> document the correct approach should that functionality be introduced, rather
> than adding unused auth/DB code.
