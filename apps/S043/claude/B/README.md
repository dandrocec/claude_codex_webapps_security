# Secure Polls

A small Node.js / Express polling application.

- **Logged-in users** create polls with 2–10 options.
- **Anyone** can vote **once per poll** and watch **live results** rendered as a bar chart (auto-refreshing every 4 seconds).
- Polls, options and votes are stored in a **SQLite** database (via `better-sqlite3`), accessed exclusively through **parameterised queries**.

The app is built with security as a first-class concern — see [Security](#security) below.

---

## Requirements

- **Node.js 18+** (uses built-in `fetch` on the client only; server needs a modern Node for `better-sqlite3` prebuilds).
- A C/C++ toolchain is only needed if `better-sqlite3` has to compile from source. Prebuilt binaries cover most platforms; on Windows, `npm install` normally just works.

## Run it locally (port 5043)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file and set a strong session secret
cp .env.example .env
#   then edit .env — at minimum set SESSION_SECRET.
#   Generate one quickly:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 3. (Optional) initialise the database explicitly — it is also created on first run
npm run init-db

# 4. Start the server
npm start
```

On Windows PowerShell, replace `cp` with `Copy-Item .env.example .env`.

Then open **http://localhost:5043**.

The port is controlled by `PORT` in `.env` (defaults to **5043**).

### First steps in the UI

1. **Register** an account, then you are logged in automatically.
2. Click **New poll**, enter a question and at least two options.
3. Open the poll and **vote** — the bar chart updates live.
4. Share the poll URL; anyone can vote once (tracked per browser).
5. As the poll's owner you'll see a **Delete poll** button.

---

## Configuration (`.env`)

| Variable         | Purpose                                                                 | Local default |
|------------------|-------------------------------------------------------------------------|---------------|
| `PORT`           | Port to listen on                                                       | `5043`        |
| `NODE_ENV`       | `production` enables proxy trust; pair with HTTPS                        | `development` |
| `SESSION_SECRET` | **Required.** Long random string used to sign the session cookie        | _none_        |
| `COOKIE_SECURE`  | `true` to mark cookies `Secure` (requires HTTPS — set `true` in prod)   | `false`       |

The app **refuses to start** if `SESSION_SECRET` is missing or left at the placeholder value.

> **Local HTTP note:** browsers will not send `Secure` cookies over plain HTTP, so `COOKIE_SECURE` defaults to `false` for `localhost` testing. **In production, serve over HTTPS and set `COOKIE_SECURE=true` and `NODE_ENV=production`.**

---

## Security

This app applies OWASP Top 10 best practices:

| Concern | How it's addressed |
|---|---|
| **SQL injection** | All database access uses `better-sqlite3` **prepared, parameterised statements** — no string concatenation of user input. |
| **Password storage** | Passwords are hashed with **bcrypt** (cost factor 12) with per-password salts. Plaintext is never stored or logged. |
| **XSS** | All dynamic output is rendered through EJS `<%= %>`, which **HTML-escapes** by default (context-aware output encoding). A strict **Content-Security-Policy** (via Helmet) blocks inline scripts. Chart data is fetched as JSON and set as text, never as HTML. |
| **Input validation** | `express-validator` validates and trims usernames, passwords, questions and options; lengths and character sets are constrained server-side. |
| **CSRF** | A per-session **synchroniser token** is required on every state-changing request (`POST`) and compared in constant time. `SameSite=Lax` cookies add defence in depth. |
| **Access control / IDOR** | Poll deletion is scoped to the owner in the SQL `WHERE` clause. Voting validates that the chosen option belongs to the target poll. Numeric IDs are validated. |
| **One vote per poll** | Enforced by a `UNIQUE(poll_id, voter_token)` database constraint, with the voter identified by an `HttpOnly` cookie. |
| **Session security** | Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` (in production). Sessions are **regenerated on login/registration** to prevent fixation, and destroyed on logout. Stored server-side in SQLite. |
| **Security headers** | **Helmet** sets CSP, `X-Content-Type-Options`, `Referrer-Policy`, frame-ancestors `none`, HSTS (in prod), and more. |
| **Error handling** | A central error handler logs full details **server-side only** and returns generic messages — no stack traces or internals reach the client. |
| **Secrets management** | Secrets are read from **environment variables** (`.env`, git-ignored); nothing sensitive is hardcoded. |
| **Brute-force / abuse** | `express-rate-limit` throttles auth endpoints and applies a global limit; request bodies are size-bounded. |

### Production checklist

- Serve behind HTTPS; set `NODE_ENV=production` and `COOKIE_SECURE=true`.
- Set a strong, unique `SESSION_SECRET`.
- Put the app behind a reverse proxy (the app already calls `trust proxy` in production).
- Back up / secure the `data/` directory (contains the SQLite databases).

---

## Project layout

```
.
├── package.json
├── .env.example
├── README.md
├── src/
│   ├── server.js            # app wiring, security middleware, error handling
│   ├── db.js                # SQLite connection + schema
│   ├── initDb.js            # `npm run init-db`
│   ├── cookies.js           # tiny cookie parser
│   ├── middleware/
│   │   └── security.js      # CSRF, voter token, auth guard, user exposure
│   └── routes/
│       ├── auth.js          # register / login / logout
│       └── polls.js         # create / view / vote / delete / results
├── views/                   # EJS templates (auto-escaped)
└── public/                  # CSS + client JS (chart, option adder)
```

Generated at runtime (git-ignored): `data/polls.sqlite`, `data/sessions.sqlite`, `node_modules/`.
