# Secure To-Do App

A small multi-user to-do application built with **Node.js + Express** and **SQLite**.
Users register, log in, and manage **only their own** tasks (add, complete, edit, delete).

## Requirements

- Node.js **18+** and npm

## Run it locally (port 5027)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env      # Windows PowerShell:  Copy-Item .env.example .env

# 3. Generate a session secret and paste it into .env (SESSION_SECRET=...)
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 4. Start the server
npm start
```

Then open **http://localhost:5027**. Register an account, log in, and start adding tasks.

> The SQLite database and session store are created automatically under `./data/`
> the first time you run the app. No separate database server is required.

## Project layout

```
server.js            App entry point, middleware & security config
db.js                SQLite connection + schema
middleware/auth.js   Auth guard, CSRF generation/verification, view locals
routes/auth.js       Register / login / logout
routes/tasks.js      Task CRUD (all queries scoped to the current user)
views/               EJS templates (auto-escaped output)
public/style.css     Styling
```

## Security measures (OWASP Top 10)

| Concern | How it's addressed |
| --- | --- |
| **SQL injection** | All database access uses `better-sqlite3` **prepared statements** with bound parameters — no string concatenation. |
| **Password storage** | Passwords are hashed with **bcrypt** (cost factor 12, per-password salt). Plaintext is never stored. |
| **Broken access control / IDOR** | Every task query is scoped by `user_id = ?`. A user can never read or modify another user's task even by guessing IDs. Auth is enforced on all `/tasks` routes. |
| **XSS** | EJS auto-escapes all interpolated values (`<%= %>`); a strict **Content-Security-Policy** (via Helmet) blocks inline/external scripts. Input is validated and length-limited. |
| **CSRF** | Synchronizer-token pattern: a per-session token is embedded in every form and verified (constant-time) on every state-changing `POST`. Cookies are `SameSite=Lax`. |
| **Session security** | Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production. Sessions are **regenerated on login/registration** to prevent fixation. Persistent server-side session store. |
| **Security headers** | **Helmet** sets CSP, `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, HSTS, and removes `X-Powered-By`. |
| **Input validation** | `express-validator` enforces username/password/task rules; request body size is capped at 16 KB. |
| **Error handling** | A central error handler returns generic messages; stack traces and internals are logged server-side only, never sent to the client. |
| **Brute force** | Auth endpoints are rate-limited. Login returns a generic message to avoid username enumeration. |
| **Secrets** | The session secret is read from `SESSION_SECRET` (env). The app refuses to start if it is missing — nothing sensitive is hardcoded. |

## Notes for production

- Run behind HTTPS and set `NODE_ENV=production` so `Secure` cookies and HSTS take effect (`trust proxy` is enabled automatically).
- Keep `.env` out of version control (already in `.gitignore`).
