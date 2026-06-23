# Food Order

A small but complete food-ordering web app built with **Node.js + Express**,
server-rendered with EJS, and backed by **SQLite**.

- **Customers** register, browse the menu, add items to a cart, and place orders.
- **Staff** see all incoming orders and update their status.
- The **order total is always computed on the server** from current menu prices —
  client-submitted prices are never trusted.

## Requirements

- Node.js **18+** and npm.
- A C/C++ toolchain is needed to build the native `better-sqlite3` module:
  - **Windows:** install the "Desktop development with C++" workload (Visual Studio Build Tools), or run `npm install --global windows-build-tools` on older setups.
  - **macOS:** `xcode-select --install`.
  - **Linux:** `build-essential` and `python3`.

## Run it locally (port 5067)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file and set a strong session secret
cp .env.example .env
#   On Windows PowerShell: Copy-Item .env.example .env
#   Generate a secret:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#   Paste it into SESSION_SECRET in .env

# 3. Start the server
npm start
```

Then open <http://localhost:5067>.

The database, menu data, and a staff account are created automatically on first
run (in the `data/` folder).

### Accounts

- **Customer:** click *Register* to create one.
- **Staff:** seeded from `.env` (`STAFF_USERNAME` / `STAFF_PASSWORD`).
  Defaults are `staff` / `ChangeMe!Staff123` — **change these** before any real use.

The port is controlled by `PORT` in `.env` (defaults to `5067`).

## How it works

| Area      | Detail |
|-----------|--------|
| Server    | `server.js` — Express setup, security middleware, routes |
| Database  | `db.js` — schema, migrations, seed data (better-sqlite3) |
| Routes    | `src/routes/*` — auth, menu, cart, orders, staff |
| Middleware| `src/middleware/*` — auth/roles, CSRF |
| Views     | `views/*.ejs` — auto-escaped templates |

## Security

This app applies OWASP Top 10 best practices:

- **SQL injection:** every query uses parameterised prepared statements (`db.js`, all routes). No string concatenation of user input into SQL.
- **Password storage:** **bcrypt** with a cost factor of 12 and per-password salts.
- **Input validation & sanitisation:** `express-validator` validates and normalises all input (types, lengths, formats, email normalisation).
- **XSS:** EJS auto-escapes all interpolated output (`<%= %>`); a strict **Content-Security-Policy** (via Helmet) blocks inline/3rd-party scripts.
- **CSRF:** synchroniser-token protection on every state-changing request (`src/middleware/csrf.js`), compared in constant time.
- **Access control / IDOR:** role checks (`requireRole`) gate staff routes; customers can only view their **own** orders (ownership enforced in the SQL `WHERE user_id = ?`).
- **Session cookies:** `HttpOnly`, `SameSite=Lax`, and `Secure` (auto-enabled in production / via `COOKIE_SECURE`). Sessions are regenerated on login to prevent fixation.
- **Security headers:** Helmet sets CSP, `X-Content-Type-Options`, `Referrer-Policy`, frame protection, HSTS (in production), and disables `X-Powered-By`.
- **Error handling:** a central handler logs full detail server-side and returns a generic message — no stack traces leak to clients.
- **Secrets:** read from environment variables (`.env`); the server refuses to start without a real `SESSION_SECRET`.
- **Brute-force protection:** login/registration are rate-limited (`express-rate-limit`).

## Notes

- `data/` (the SQLite files) and `.env` are git-ignored.
- For production, run behind HTTPS, set `NODE_ENV=production`, and use a strong unique `SESSION_SECRET` and staff password.
