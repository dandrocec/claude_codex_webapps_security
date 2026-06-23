# Coffee Shop — Flask E-commerce Platform

A small but complete e-commerce application with a **customer storefront** and an
**admin back office**, built with Flask + SQLite. All monetary totals are
computed **server-side** from the authoritative prices stored in the database.

## Features

**Customer storefront**
- Register / sign in / sign out
- Browse the product catalogue and view product detail pages
- Add to cart, update quantities, remove items
- Checkout with shipping details (server computes the total)
- View order history and individual orders
- Leave a 1–5 star review (only for products you have actually purchased)

**Admin back office** (`/admin`, admin accounts only)
- Create and edit products
- Manage inventory (stock levels, active/hidden)
- View all orders and update order status

## Tech stack

- Flask 3, Jinja2 templates (autoescaping on)
- SQLite via the standard-library `sqlite3` driver — **every query is
  parameterised**
- Flask-Login (sessions), Flask-WTF (CSRF + form validation)
- Argon2id password hashing (`argon2-cffi`)

## Running locally (port 5097)

Requires Python 3.10+.

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment (copy the example and edit it)
copy .env.example .env        # Windows
# cp .env.example .env        # macOS/Linux
#   -> set SECRET_KEY to a long random value:
#      python -c "import secrets; print(secrets.token_hex(32))"

# 4. Run it
python app.py
```

Then open <http://127.0.0.1:5097>.

On the **first run** the app automatically creates `shop.sqlite3`, builds the
schema, seeds sample products, and creates an admin account from
`ADMIN_EMAIL` / `ADMIN_PASSWORD` (defaults: `admin@example.com` /
`ChangeMe123!`). Sign in with those to reach `/admin`.

To reset the database, stop the app, delete `shop.sqlite3`, and start again.
You can also manage it explicitly:

```bash
flask --app app init-db   # (re)create tables
flask --app app seed      # seed admin + sample products
```

## Configuration (environment variables)

| Variable         | Purpose                                                        |
|------------------|----------------------------------------------------------------|
| `SECRET_KEY`     | Signs session cookies and CSRF tokens. **Set this.**           |
| `SECURE_COOKIES` | `1` to mark session cookies `Secure` (HTTPS only). `0` for dev.|
| `ADMIN_EMAIL`    | Seed admin email.                                              |
| `ADMIN_PASSWORD` | Seed admin password.                                           |
| `DATABASE`       | SQLite file path (default `shop.sqlite3`).                     |

> **Note on `SECURE_COOKIES`:** keep it `0` for local HTTP development,
> otherwise the browser will not send the session cookie over `http://` and
> you won't be able to stay signed in. Set it to `1` in production behind HTTPS.

## How the security requirements are met (OWASP Top 10)

- **SQL injection** — all DB access uses parameterised queries (`?`
  placeholders) in `db.py` / `models.py`; no string interpolation of input.
- **Password storage** — Argon2id with a per-password random salt
  (`security.py`); hashes transparently upgraded on login when params change.
- **Input validation** — every form is a WTForms form with type, length and
  range validators (`forms.py`); IDs are typed route converters (`<int:...>`).
- **XSS** — Jinja2 autoescaping is on for all rendered output; no `|safe` on
  user data; a strict Content-Security-Policy (no inline scripts/styles) adds
  defence in depth.
- **CSRF** — Flask-WTF `CSRFProtect` is enabled globally; every state-changing
  form includes a CSRF token; expired tokens render a friendly error.
- **Broken access control / IDOR** — customers can only load their own cart,
  orders and reviews (ownership is enforced in the SQL `WHERE` clause);
  admin routes are gated by an `admin_required` decorator; reviews require a
  prior purchase.
- **Secure session cookies** — `HttpOnly`, `SameSite=Lax`, and `Secure`
  (toggleable) are configured in `config.py`.
- **Security headers** — `Content-Security-Policy`, `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`,
  COOP/CORP and HSTS are set on every response (`security.py`).
- **Error handling** — debug is forced off; custom 400/403/404/413/500 handlers
  log details server-side and never leak stack traces to clients.
- **Secrets management** — secrets are read from environment variables
  (`.env` supported); nothing sensitive is hardcoded.
- **Server-side totals** — order totals and line prices are computed from the
  database inside a single transaction at checkout (`models.place_order`),
  never trusted from the client. Stock is validated and decremented atomically.

## Project layout

```
app.py        Application factory, error handlers, entry point (port 5097)
config.py     Configuration from environment
db.py         SQLite connection helpers + CLI commands
schema.sql    Database schema
models.py     Data-access helpers (parameterised queries, access control)
security.py   Argon2 hashing + HTTP security headers
forms.py      WTForms (validation + CSRF)
auth.py       Register / login / logout + admin_required
store.py      Storefront: browse, cart, checkout, reviews, orders
admin.py      Admin: products, inventory, orders
seed.py       Sample data + admin account
templates/    Jinja2 templates
static/       CSS
```
