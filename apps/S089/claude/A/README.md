# Acme Shop — Flask online shop with checkout

A small but complete online store built with **Flask** and **SQLite**. Shoppers
browse products, build a cart, and check out through a **payment provider's
sandbox**. The order is marked **paid** by a **webhook** call-back — not by the
browser redirect — just like a real integration. Users get their own order
history and admins get a list of every order.

## Features

- Product catalogue + product detail pages
- Session-based cart (add / update quantities / remove)
- User registration, login, logout (passwords hashed with Werkzeug)
- Checkout that creates a `pending` order and redirects to the payment provider
- **Webhook endpoint** (`POST /webhook`) with HMAC signature verification that
  marks the matching order `paid` (idempotent) and decrements stock
- Per-user order history + order detail
- Admin order list with status filters
- SQLite storage via SQLAlchemy; demo products + an admin user are seeded on
  first run

## Payment providers

The app ships with two interchangeable providers that share one webhook
contract. Selected with the `PAYMENT_PROVIDER` environment variable.

| Provider | Value | Needs external setup? |
|----------|-------|------------------------|
| **Mock sandbox** (default) | `mock` | No — fully self-contained |
| **Stripe Checkout (test mode)** | `stripe` | Yes — Stripe test keys |

### Mock sandbox (default)

No accounts, no keys. Checkout redirects to an in-app "hosted payment page".
When you click **Pay**, the page's server side posts a *signed* event to this
app's own `/webhook` — exactly how a real provider's backend would call you —
and the order flips to **paid**. This makes the whole flow demonstrable offline.

### Stripe (optional)

Set these and the same `/webhook` endpoint will verify real Stripe signatures:

```
PAYMENT_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_test_...
WEBHOOK_SECRET=whsec_...        # Stripe endpoint signing secret
```

Use the [Stripe CLI](https://stripe.com/docs/stripe-cli) to forward events:

```
stripe listen --forward-to localhost:5089/webhook
```

## Run it locally (port 5089)

Requires **Python 3.9+**.

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS / Linux:
source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Run (serves on http://localhost:5089)
python app.py
```

Then open <http://localhost:5089>.

The SQLite database (`shop.db`), demo products, and an admin account are created
automatically on first launch.

### Default admin account

```
email:    admin@example.com
password: admin123
```

Override with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` environment variables before
the first run. Register any other email through the UI to test a normal shopper.

## Try the flow

1. Register or log in.
2. Add products to your cart, open the cart, click **Checkout**.
3. You land on the sandbox payment page → click **Pay**.
4. The webhook fires and the order shows as **paid**.
5. See it under **My Orders**; sign in as the admin to see it under **Admin**.

## Configuration (environment variables)

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `5089` | Port to serve on |
| `BASE_URL` | `http://localhost:5089` | Used to build provider redirect + webhook URLs |
| `SECRET_KEY` | `dev-secret-change-me` | Flask session signing key |
| `DATABASE_URL` | `sqlite:///shop.db` | SQLAlchemy database URL |
| `PAYMENT_PROVIDER` | `mock` | `mock` or `stripe` |
| `WEBHOOK_SECRET` | `whsec_mock_dev_secret` | Signs/verifies webhook payloads |
| `STRIPE_SECRET_KEY` | _(empty)_ | Stripe test secret key (stripe mode) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@example.com` / `admin123` | Seeded admin |

## Project layout

```
app.py          Flask app: routes, cart, checkout, webhook, auth, admin
config.py       Environment-driven configuration
models.py       SQLAlchemy models (User, Product, Order, OrderItem)
payments.py     Provider abstraction (mock + Stripe) + signature helpers
templates/      Jinja2 templates
static/style.css
requirements.txt
```

## Notes

- This is a demo. Don't enter real card numbers; the sandbox charges nothing.
- `debug=True` is on for convenience — turn it off for any real deployment and
  set a strong `SECRET_KEY`.
