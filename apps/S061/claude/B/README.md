# LearnHub — Secure E-Learning App

A small Node.js / Express e-learning platform.

- **Instructors** create courses and lessons, and can edit/delete only their own.
- **Students** browse the catalog, enrol in courses, and mark lessons complete.
- **Course content (lessons) is visible only to enrolled students** (and the owning instructor).
- Data is stored in a local **SQLite** database.

## Requirements

- Node.js 18 or newer (includes `npm`)
- A C/C++ toolchain is **not** usually needed — `better-sqlite3` ships prebuilt binaries for common platforms. On Windows, if a build is triggered, install the "Desktop development with C++" workload or run `npm install --global windows-build-tools`.

## Run it locally (port 5061)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file and set a real secret
cp .env.example .env
#   then edit .env and set SESSION_SECRET. Generate one with:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 3. Start the app
npm start
```

Then open <http://localhost:5061>.

The database and session store are created automatically under `./data/` on first run. Delete that folder to reset all data.

> On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

## Configuration (environment variables)

| Variable         | Default       | Purpose                                                        |
| ---------------- | ------------- | -------------------------------------------------------------- |
| `PORT`           | `5061`        | Port to listen on                                              |
| `NODE_ENV`       | `development` | `production` enables Secure cookies / proxy trust (needs HTTPS)|
| `SESSION_SECRET` | *(required)*  | Long random string used to sign the session cookie            |

The app exits on startup if `SESSION_SECRET` is missing — secrets are never hardcoded.

## Try it

1. Register an **instructor** account, create a course, and add a couple of lessons.
2. In a separate browser (or private window), register a **student** account.
3. As the student, open the course — lessons are locked until you **Enrol**.
4. After enrolling, open a lesson and **Mark complete**; progress shows on the course page.

## Project layout

```
server.js            App setup: security headers, sessions, routing, error handling
db.js                SQLite connection + schema (foreign keys enforced)
models.js            All data access — exclusively parameterised queries
middleware.js        Auth, role guards, and CSRF (synchronizer-token) protection
routes/auth.js       Register / login / logout
routes/courses.js    Courses, lessons, enrolment, completion (with access control)
views/               EJS templates (auto-escaped output)
public/style.css     Styles
```

## Security measures (OWASP Top 10)

- **Injection (A03):** every query uses bound parameters via `better-sqlite3` prepared statements; no string concatenation of user input into SQL.
- **Authentication (A07):** passwords hashed with **bcrypt** (cost 12, salted). Login responses and timing are uniform to resist user enumeration; the session is regenerated on login/registration to prevent fixation. Auth endpoints are rate-limited.
- **Access control / IDOR (A01):** role guards (`requireRole`) plus per-resource ownership/enrolment checks. Route IDs are validated as positive integers. Students can only toggle completion for their own user id; lessons are only viewable by the owner or enrolled students.
- **Cross-Site Request Forgery:** synchronizer CSRF token stored in the session and required (constant-time compared) on every state-changing `POST`. Cookies also use `SameSite=Lax`.
- **XSS (A03):** all dynamic output is rendered through EJS `<%= %>` auto-escaping (context-aware HTML encoding); lesson/description text is shown with `white-space: pre-wrap` rather than raw HTML. Input is validated and length-bounded with `express-validator`.
- **Security misconfiguration / headers (A05):** `helmet` sets a strict Content-Security-Policy (`default-src 'self'`, no inline scripts), `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors 'none'`, HSTS, etc.
- **Session cookies:** `HttpOnly`, `SameSite=Lax`, and `Secure` in production; named `sid`; 4-hour rolling expiry; stored server-side in SQLite.
- **Error handling:** a central handler logs details server-side and returns a generic message — stack traces and internals are never sent to the client.
- **Secrets:** read only from environment variables; the app refuses to start without `SESSION_SECRET`.
- **Request hardening:** body size is capped (64 KB) and a global rate limiter is applied.

## Notes / scope

This is a focused demo. For a production deployment you would additionally terminate TLS (set `NODE_ENV=production` behind an HTTPS proxy), add email verification / password reset, account lockout, audit logging, and automated tests.
