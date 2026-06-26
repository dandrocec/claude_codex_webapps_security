# Flask Online Shop

A small Flask shop with product browsing, cart checkout, sandbox payments, signed payment webhooks, per-user order history, and an admin order list. Data is stored in SQLite.

## Run locally on port 5089

```powershell
python -m venv .venv
.\\.venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
$env:SECRET_KEY = "replace-with-a-long-random-secret"
$env:PAYMENT_WEBHOOK_SECRET = "replace-with-a-long-random-webhook-secret"
$env:ADMIN_EMAIL = "admin@example.com"
$env:ADMIN_PASSWORD = "replace-with-a-strong-admin-password"
$env:SESSION_COOKIE_SECURE = "0"
python app.py
```

Open `http://127.0.0.1:5089`.

`SESSION_COOKIE_SECURE=0` is only for local HTTP testing. Leave it unset or set it to `1` behind HTTPS.

## Stripe test-mode checkout

The app runs with its built-in sandbox payment page by default. To use Stripe Checkout in test mode, set:

```powershell
$env:STRIPE_SECRET_KEY = "sk_test_..."
$env:STRIPE_WEBHOOK_SECRET = "whsec_..."
```

Configure Stripe CLI or the Stripe dashboard to send checkout webhooks to:

```text
http://127.0.0.1:5089/webhooks/payments
```

## Notes

The app uses parameterized SQLite queries, bcrypt password hashes, CSRF protection for state-changing browser requests, signed webhook verification, ownership checks for orders, secure cookie settings, security headers, and generic error pages.
