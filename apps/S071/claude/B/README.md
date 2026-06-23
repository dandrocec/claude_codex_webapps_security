# Secure Auction Site

A small auction web app built with **Node.js + Express** and **SQLite**.

- Sellers list items with a starting price and an end time.
- Buyers place bids that must beat the current highest bid (and meet the
  starting price for the first bid).
- When an item's end time passes, the highest bidder is shown as the winner.

## Requirements

- Node.js 18 or newer (developed on Node 24).
- No external database — data is stored in a local SQLite file.

## Run locally on port 5071

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env

# 3. (Recommended) set a stable session secret in .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#    paste the output as SESSION_SECRET=... in .env

# 4. Start the server
npm start
```

Then open <http://localhost:5071>.

> The port defaults to **5071**. It is set via `PORT` in `.env` (already 5071 in
> `.env.example`). If you skip step 3, the app still runs in development using a
> random ephemeral session secret (you'll be logged out on restart).

`npm run dev` starts the server with auto-reload (`node --watch`).

The SQLite database and session store are created automatically under `./data/`.

## Trying it out

1. Register two accounts (e.g. `alice`, `bob`).
2. As `alice`, click **Sell an item**, set a starting price and a near-future
   end time.
3. Log in as `bob` and place a bid above the starting price.
4. When the end time passes, reload the item page — `bob` is shown as the winner.

## Project layout

```
src/
  server.js              app wiring, security headers, sessions, error handling
  config.js              environment-driven configuration (secrets from env)
  db.js                  SQLite connection + schema
  models.js              prepared-statement data access (parameterised queries)
  middleware/
    auth.js              session user loading + requireAuth guard
    csrf.js              synchronizer-token CSRF protection
  routes/
    auth.js              register / login / logout
    auctions.js          listing / detail / bidding / delete
  views/                 EJS templates (auto-escaped output)
  public/style.css       static stylesheet
```

## Security measures (OWASP Top 10)

| Area | Implementation |
|------|----------------|
| **SQL injection** | All DB access uses `better-sqlite3` prepared statements with bound parameters — no string-built SQL. |
| **Password storage** | `bcrypt` with a cost factor of 12 (per-password salt built in). |
| **Input validation** | `express-validator` rules on every form; integer route-param validation; request body size capped. |
| **XSS** | EJS `<%= %>` performs context-aware HTML output encoding; a strict CSP (no `unsafe-inline`, external CSS/JS only) is set via Helmet. |
| **CSRF** | Per-session synchronizer token embedded in every form and verified (constant-time compare) on all non-GET requests. |
| **Access control / IDOR** | Ownership checks: a seller can't bid on their own item; only the owning seller can delete a listing (and only with no bids); route IDs are validated as integers. |
| **Session security** | `express-session` with `HttpOnly`, `SameSite=Lax`, and `Secure` cookies (forced on in production); session is regenerated on login/registration to prevent fixation. |
| **Security headers** | Helmet sets CSP, `X-Content-Type-Options`, `Referrer-Policy`, frame-ancestors `none`, etc. |
| **Error handling** | Central handler logs detail server-side and returns generic messages — no stack traces or internal errors leak to clients. |
| **Secrets** | Read from environment variables (`.env`); nothing hardcoded. App refuses to start in production without `SESSION_SECRET`. |
| **Brute force** | Rate limiting on login/registration endpoints; login responses avoid username enumeration. |

## Notes

- All times are stored and displayed in **UTC**. The "end time" field accepts
  your local time and is converted to UTC on save.
- For production, set `NODE_ENV=production`, serve over HTTPS (behind a proxy),
  and provide a strong `SESSION_SECRET`. `Secure` cookies are enabled
  automatically in production.
