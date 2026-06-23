# Tiny Shop — Flask online shop with checkout

A small but complete online shop: browse products, add to a cart, check out
through a payment provider **sandbox**, and have a **signed webhook** mark the
order as paid. Includes per-user order history and an admin order list.
Data is stored in SQLite.

Built with security as a first-class concern (see **Security** below).

---

## Features

- Product catalogue and product detail pages
- Session cart (add / update / remove)
- Authenticated checkout that creates a **pending** order
- Hosted-checkout + **signed webhook** payment flow
  - `sandbox` provider (default): self-contained, no external account needed
  - `stripe` provider: real Stripe Checkout in test mode (optional)
- Per-user order history with ownership-scoped access
- Admin-only "all orders" list
- SQLite storage via parameterised queries

---

## Requirements

- Python 3.11+
- The packages in `requirements.txt`

## Run locally on port 5089

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure secrets
cp .env.example .env        # Windows: copy .env.example .env
#   then generate values:
python -c "import secrets; print('SECRET_KEY=' + secrets.token_hex(32))"
python -c "import secrets; print('WEBHOOK_SECRET=' + secrets.token_hex(32))"
#   paste those two lines into .env (replacing the empty ones)

# 4. Create the database and seed demo data (products + admin user)
flask --app app init-db
flask --app app seed         # prints the generated admin password ONCE

# 5. Start the server on port 5089
flask --app app run --port 5089
```

Open <http://localhost:5089>.

> The `seed` command prints a randomly generated admin password the first time
> (unless you set `ADMIN_PASSWORD` in `.env`). Note it down — it is not stored
> anywhere in plain text.

### Try the full flow

1. Register a normal user and log in.
2. Add products to the cart and click **Checkout** — a pending order is created.
3. You're redirected to the **sandbox payment page**. Click **Pay**.
4. The sandbox delivers a signed webhook to `/webhook`; the order flips to
   **paid** and appears that way in *My orders*.
5. Log in as the admin user to see **Admin → all orders**.

---

## Using real Stripe (optional)

Set in `.env`:

```
PAYMENT_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
BASE_URL=http://localhost:5089
```

Forward Stripe test webhooks to the app:

```bash
stripe listen --forward-to localhost:5089/webhook
```

Checkout then redirects to Stripe's hosted test page; on
`checkout.session.completed` the order is marked paid.

---

## Security

OWASP Top 10 mitigations applied throughout:

| Area | How it's handled |
|------|------------------|
| **Injection (SQLi)** | All queries use parameterised `?` placeholders (`db.py`, `models.py`); no string-built SQL. |
| **Authentication** | Passwords hashed with **bcrypt** (salted, adaptive) in `models.py`. |
| **Sensitive cookies** | Session/remember cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` when `SESSION_COOKIE_SECURE=1`. |
| **XSS** | Jinja2 autoescaping (context-aware output encoding) + a strict `Content-Security-Policy`. |
| **CSRF** | Flask-WTF CSRF tokens on every state-changing form; the webhook is exempt but verified by HMAC signature instead. |
| **Access control / IDOR** | Orders are always fetched scoped to the owning user; admin routes gated by an `admin_required` check. |
| **Input validation** | WTForms validators on every user-supplied field (email, lengths, quantity ranges). |
| **Payment integrity** | Order totals are computed server-side from DB prices, never trusted from the client. Webhooks require a valid HMAC-SHA256 signature with replay protection. |
| **Security headers** | CSP, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and HSTS (when on HTTPS). |
| **Error handling** | Custom error pages; stack traces and internals are logged server-side, never returned to clients. |
| **Secrets** | Read from environment / `.env`; nothing sensitive is hardcoded. |

### Production notes

- Serve over HTTPS and set `SESSION_COOKIE_SECURE=1` (enables Secure cookies + HSTS).
- Set strong, persistent `SECRET_KEY` and `WEBHOOK_SECRET` values.
- Keep `FLASK_DEBUG=0`.
- Run behind a production WSGI server (e.g. `gunicorn "app:app"`), not the dev server.

---

## Project layout

```
flask-shop/
├── app.py              # application factory, security headers, error handlers, CLI
├── config.py           # env-driven configuration
├── db.py               # SQLite connection + init-db command
├── models.py           # data access (parameterised) + bcrypt password hashing
├── forms.py            # WTForms input validation + CSRF
├── payments.py         # provider dispatch + webhook signing/verification
├── blueprints/
│   ├── auth.py         # register / login / logout
│   ├── main.py         # storefront, cart, checkout, orders, webhook
│   ├── admin.py        # admin order list
│   └── sandbox.py      # built-in payment sandbox (hosted page + webhook sender)
├── templates/          # Jinja2 templates (autoescaped)
├── static/style.css
├── schema.sql
├── requirements.txt
└── .env.example
```
