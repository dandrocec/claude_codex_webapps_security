# 🎬 Movie Watchlist

A small, secure personal movie watchlist built with **Node.js + Express + SQLite**.

Users register and log in, add movies (title, year, status, personal rating),
and filter their list by status (*To watch / Watching / Watched*). Each user
sees and manages **only their own** movies.

## Features

- User registration & login (passwords hashed with **bcrypt**)
- Add movies with title, year, status and optional 1–10 rating
- Filter the list by status
- Server-side rendered UI (EJS) with auto-escaped output

## Security

This app follows OWASP Top 10 best practices:

| Concern | How it's addressed |
| --- | --- |
| **SQL injection** | All queries use `better-sqlite3` **prepared statements** with bound parameters. |
| **Password storage** | **bcrypt** (cost 12, per-password salt). Plaintext is never stored. |
| **Input validation** | `express-validator` validates/sanitises every field; DB has `CHECK` constraints. |
| **XSS** | EJS `<%= %>` context-aware escaping; strict **CSP** via Helmet blocks inline scripts. |
| **CSRF** | Synchronizer token on every state-changing form, verified in constant time. |
| **Access control / IDOR** | Every query is scoped to the logged-in `user_id`; you can't touch other users' rows. |
| **Session security** | Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production; session ID is regenerated on login to prevent fixation. |
| **Security headers** | Helmet sets CSP, `X-Content-Type-Options`, `Referrer-Policy`, HSTS (prod), etc. |
| **Error handling** | A central handler returns generic messages; stack traces are logged server-side only. |
| **Secrets** | `SESSION_SECRET` and config come from environment variables (`.env`), never hardcoded. |
| **Brute force** | Rate limiting on `/login` and `/register`. |

## Requirements

- Node.js **18+** (tested on Node 24)
- npm

## Run it locally (port 5051)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env        # Windows PowerShell: copy .env.example .env

# 3. Set a strong session secret in .env
#    Generate one with:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#    Paste the output as SESSION_SECRET in .env

# 4. Start the server
npm start
```

Then open **http://localhost:5051** and register an account.

> The port defaults to `5051` (configurable via `PORT` in `.env`).

### Development

```bash
npm run dev   # restarts on file changes (node --watch)
```

## Notes

- Data is stored in `./data/watchlist.sqlite` (created automatically). Sessions
  are stored in `./data/sessions.sqlite`. Both are git-ignored.
- For local plain-HTTP development the session cookie's `Secure` flag is **off**
  (set `NODE_ENV=production` or `COOKIE_SECURE=true` only when serving over HTTPS,
  otherwise the browser will drop the cookie and login won't persist).

## Project structure

```
server.js              # entry point
src/
  app.js               # Express app, middleware, security config
  db.js                # SQLite connection + schema
  middleware/
    auth.js            # requireAuth / redirectIfAuth
    csrf.js            # synchronizer-token CSRF protection
  routes/
    auth.js            # register / login / logout
    movies.js          # list / filter / add / delete
views/                 # EJS templates
public/style.css       # styles
```
