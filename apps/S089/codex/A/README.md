# Flask Online Shop

A small Flask shop with user accounts, product browsing, carts, Stripe Checkout sandbox payments, webhook-paid orders, order history, and an admin order list. Data is stored in SQLite.

## Run Locally

1. Create and activate a virtual environment.
2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Configure Stripe test credentials:

```bash
set FLASK_SECRET_KEY=dev-secret
set STRIPE_SECRET_KEY=sk_test_your_key
set STRIPE_PUBLISHABLE_KEY=pk_test_your_key
set STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
```

On macOS/Linux, use `export` instead of `set`.

4. Start the app on port `5089`:

```bash
python app.py
```

Open `http://localhost:5089`.

## Stripe Sandbox

The checkout flow uses Stripe Checkout in test mode. To receive local webhook events, run the Stripe CLI in another terminal:

```bash
stripe listen --forward-to localhost:5089/webhook/stripe
```

Then use the printed webhook signing secret as `STRIPE_WEBHOOK_SECRET`.

If Stripe credentials are not configured, checkout creates a pending order and shows a local fallback page with instructions.

## Demo Admin

On first startup, the app creates:

- Admin user: `admin@example.com`
- Password: `admin123`

Change this password before using the app for anything beyond local testing.
