# JSON Validator &amp; Formatter

A small Node.js / Express web app. Paste JSON into a textarea and submit; the
app validates it and either shows a neatly indented version or a clear error
message (with line/column) describing the problem.

## Requirements

- Node.js 18 or newer

## Run it locally (port 5020)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file and set a strong session secret
cp .env.example .env                                   # Windows: copy .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#   -> paste the output as SESSION_SECRET in .env

# 3. Start the server
npm start
```

Then open <http://localhost:5020>.

The port is configurable via `PORT` in `.env` and defaults to `5020`.

## How it works

- `GET /` renders the form.
- `POST /validate` parses the submitted text with `JSON.parse`. On success it
  returns `JSON.stringify(parsed, null, 2)`; on failure it returns a friendly
  message instead of a raw exception.

## Security

This app follows OWASP Top 10 best practices appropriate to its scope:

- **Injection (A03):** The app uses no database and runs no shell/eval, so
  there is no SQL/command-injection surface. Untrusted input is only ever
  passed to `JSON.parse`, which cannot execute code. *If a database were added,
  all queries would use parameterised statements.*
- **XSS (A03):** All dynamic values are rendered through EJS auto-escaping
  (`<%= %>`), so user input — including invalid JSON echoed back into the
  textarea and the formatted output — is HTML-encoded. A strict
  Content-Security-Policy (`script-src 'self'`, no inline scripts) is set as a
  second layer of defence.
- **CSRF (A01):** A per-session synchronizer token is embedded in the form and
  verified with a constant-time comparison on every state-changing `POST`.
  `SameSite=Lax` cookies add defence in depth.
- **Session cookies (A07):** Cookies are `HttpOnly`, `SameSite=Lax`, and
  `Secure` in production (`NODE_ENV=production`).
- **Security headers (A05):** Set via Helmet (CSP, `X-Content-Type-Options`,
  `X-Frame-Options: DENY` / `frame-ancestors 'none'`, referrer policy, etc.).
- **Error handling (A09):** A central error handler logs full detail
  server-side and returns only a generic message to the client — no stack
  traces or internals are leaked.
- **Secrets management (A05):** `SESSION_SECRET` is read from the environment;
  the app refuses to start if it is missing, and no secret is hardcoded.
- **Input validation:** Request bodies are capped (1 MB) and input type is
  checked before processing.

### Not applicable to this app

The task listed some requirements that only apply to apps with accounts or a
database. This tool is stateless and has neither, so they have no attack
surface here. The patterns that *would* be used:

- **Password hashing (bcrypt/Argon2):** there is no authentication, so no
  passwords are stored. With auth, passwords would be hashed with Argon2id (or
  bcrypt) using a per-user salt.
- **Access control / IDOR (A01):** there are no per-user resources or object
  identifiers to authorize. With user-owned data, every request would be
  checked for ownership before acting on a record.

Adding accounts/a database purely to satisfy these would only increase the
attack surface without serving the app's purpose.
