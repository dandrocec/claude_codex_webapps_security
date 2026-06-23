# Quiz Platform

A small but production-minded quiz application built with **Node.js + Express**.

- **Teachers** register, create multiple-choice quizzes (with the correct answer marked), and view each student's score.
- **Students** register, take published quizzes, and immediately receive an automatically computed score with feedback.
- **Correct answers are never sent to the browser before submission** — grading happens entirely on the server.
- Data is stored in **SQLite** (zero external services required to run locally).

## Requirements

- Node.js **18+** (uses the built-in test-free toolchain; `better-sqlite3` ships prebuilt binaries for common platforms).

## Run it locally on port 5075

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env
#    Then set a strong SESSION_SECRET, e.g.:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#    Paste the output as SESSION_SECRET in .env

# 3. (Optional) Seed demo accounts and a sample quiz
npm run seed
#    Creates:  teacher / password123   and   student / password123

# 4. Start the server
npm start
```

Now open **http://localhost:5075**.

> On Windows PowerShell, use `copy .env.example .env` instead of `cp`.

The port is controlled by `PORT` in `.env` (defaults to `5075`).

## How it works

| Area            | Choice                                                            |
|-----------------|-------------------------------------------------------------------|
| Web framework   | Express                                                           |
| Database        | SQLite via `better-sqlite3` (parameterised prepared statements)  |
| Templating      | EJS with automatic HTML escaping (`<%= %>`)                       |
| Sessions        | `express-session` + `connect-sqlite3` store                      |
| Passwords       | `bcrypt` (cost factor 12, per-password salt)                     |

### Roles & flow

1. Register as a **teacher** or **student**.
2. Teacher → "New quiz" → add questions/options, mark the correct one, optionally publish.
3. Student → dashboard lists published quizzes → take → submit → see score + per-question feedback.
4. Teacher → "manage" page shows all attempts and scores for **their own** quizzes only.

## Security measures (OWASP Top 10)

| Risk | Mitigation in this app |
|------|------------------------|
| **A01 Broken Access Control / IDOR** | Every quiz/attempt action re-checks ownership server-side (`teacher_id`/`student_id`); object IDs are validated as positive integers; submitted option IDs are verified to belong to the question. |
| **A02 Cryptographic Failures** | Passwords hashed with bcrypt (salted, cost 12). Session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production. Secrets read from environment variables, never hardcoded. |
| **A03 Injection (SQLi)** | All database access uses **parameterised prepared statements** — no string concatenation of user input. |
| **A03 Injection (XSS)** | EJS auto-escapes all interpolated output (`<%= %>`); no `<%- %>` is used with user data. A strict Content-Security-Policy blocks inline scripts; client JS is served same-origin. Inputs are validated/sanitised with `express-validator`. |
| **A04 Insecure Design** | Correct answers are excluded from the data sent to the quiz-taking page; grading is server-side only. Session is regenerated on login/registration to prevent fixation. |
| **A05 Security Misconfiguration** | `helmet` sets security headers (CSP, `X-Content-Type-Options`, `Referrer-Policy`, frame-ancestors `none`, etc.). Errors return generic messages — no stack traces leak to clients. Request body size is capped. |
| **A07 Auth Failures** | Generic login errors prevent username enumeration (plus constant-time-ish bcrypt path for unknown users); rate limiting on `/login` and `/register`. |
| **CSRF** | Synchronizer-token pattern: a per-session token is required (and constant-time compared) on every state-changing `POST`. |

## Project layout

```
src/
  server.js            App setup, security middleware, error handling
  db.js                SQLite connection + schema
  seed.js              Optional demo data
  middleware/
    auth.js            requireLogin / requireRole (access control)
    csrf.js            CSRF token provisioning + verification
  routes/
    auth.js            register / login / logout
    quizzes.js         dashboards, quiz CRUD, taking & grading
  views/               EJS templates (auto-escaped)
  public/              CSS + same-origin client JS
```

## Notes

- The SQLite database and session store are created under `./data/` on first run.
- For real deployment, run behind HTTPS with `NODE_ENV=production` so the `Secure` cookie flag is enabled, and set a strong `SESSION_SECRET`.
