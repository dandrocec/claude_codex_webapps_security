# Survey Builder

A small, secure survey application built with **Node.js + Express** and **SQLite**.

A logged-in user can:

- Register / log in / log out
- Create surveys with multiple questions
- Share a **public response link** (anyone with the link can submit, no login required)
- View collected responses in a table

## Requirements

- Node.js **18+** (uses `node:` built-ins and modern APIs)
- npm

`better-sqlite3` compiles a native module on install, so on some systems you
may need build tools (e.g. Xcode CLT on macOS, `build-essential` on Linux, or
the "Desktop development with C++" workload / windows-build-tools on Windows).

## Run locally on port 5055

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file from the template
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env

# 3. Generate a strong session secret and put it in .env (SESSION_SECRET=...)
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 4. Start the server
npm start
```

Then open <http://localhost:5055>.

The port is read from `PORT` in `.env` (defaults to `5055`). The SQLite
database and session store are created automatically under `./data/`.

> First run: register a new account, create a survey, open its **Share link**
> in a private window to submit a response, then return to **View responses**.

## Project layout

```
server.js          App setup: helmet, sessions, CSRF, routes, error handling
db.js              SQLite connection + schema (parameterised statements only)
middleware.js      CSRF (synchronizer token), auth guard, user context
routes/
  auth.js          Register / login / logout
  surveys.js       Authenticated survey CRUD + responses table (ownership-scoped)
  public.js        Public token-based fill-out + submission
views/             EJS templates (auto-escaped output)
public/            Static CSS + JS (no inline scripts, CSP-friendly)
```

## Security measures (OWASP Top 10)

| Concern | How it is addressed |
| --- | --- |
| **SQL injection** | All queries use `better-sqlite3` prepared statements with bound parameters. No string concatenation of user input into SQL. |
| **Password storage** | Passwords hashed with **bcrypt** (cost factor 12, per-hash salt). Plaintext is never stored or logged. |
| **Broken access control / IDOR** | Every survey query is scoped by `user_id` in the `WHERE` clause; surveys are addressed by id only for owners. Public access is via an unguessable random token, never a sequential id. |
| **XSS** | Input is validated/length-capped; output is rendered through EJS `<%= %>` which performs context-aware HTML escaping. A strict **Content-Security-Policy** (no inline/3rd-party scripts) is set via Helmet. |
| **CSRF** | Synchronizer-token pattern: a per-session random token must accompany every state-changing (POST) request. Session cookie is also `SameSite=Lax`. |
| **Session security** | Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production. Session id is **regenerated on login/registration** to prevent fixation. Sessions are persisted server-side (SQLite store). |
| **Security headers** | `helmet` sets CSP, `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors 'none'`, `Referrer-Policy`, HSTS (in production), etc. |
| **Input validation** | `express-validator` plus explicit length/format checks and payload size limits on all forms. |
| **Error handling** | A central error handler logs details **server-side only** and returns a generic message — no stack traces or internal details leak to clients. |
| **Secrets management** | `SESSION_SECRET` and other config are read from environment variables (`.env`, git-ignored). The app refuses to start without a session secret. |
| **Rate limiting** | Global limiter plus stricter limits on auth and public submission endpoints to blunt brute-force and spam. |

## Notes for production

- Run behind HTTPS (a reverse proxy). `NODE_ENV=production` enables `Secure`
  cookies and `trust proxy`.
- Back up / secure the `./data/` directory (it holds the database and sessions).
