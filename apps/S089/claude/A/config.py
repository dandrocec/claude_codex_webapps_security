"""Application configuration, read from environment variables with sane defaults.

The defaults make the app fully runnable locally with no external setup:
the payment provider is a built-in *mock sandbox* that behaves like a real
hosted-checkout provider (redirect to a payment page, then a signed webhook
call-back marks the order paid). Set PAYMENT_PROVIDER=stripe plus the Stripe
keys to use Stripe's real test/sandbox mode instead.
"""
import os

BASE_DIR = os.path.abspath(os.path.dirname(__file__))


class Config:
    # Flask
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-change-me")

    # Database (SQLite file living next to the app)
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        "DATABASE_URL", "sqlite:///" + os.path.join(BASE_DIR, "shop.db")
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # Where the app is reachable. Used to build the provider's success/cancel
    # and webhook URLs.
    SERVER_PORT = int(os.environ.get("PORT", "5089"))
    BASE_URL = os.environ.get("BASE_URL", f"http://localhost:{SERVER_PORT}")

    # Payment provider: "mock" (default, no external deps) or "stripe".
    PAYMENT_PROVIDER = os.environ.get("PAYMENT_PROVIDER", "mock").lower()

    # Shared secret used to sign/verify webhook payloads from the provider.
    # For the mock provider this is our own HMAC secret; for Stripe it is the
    # endpoint signing secret (whsec_...).
    WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "whsec_mock_dev_secret")

    # Stripe keys (only needed when PAYMENT_PROVIDER=stripe).
    STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")

    # Seed an admin account on first run.
    ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@example.com")
    ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")

    CURRENCY = "usd"
