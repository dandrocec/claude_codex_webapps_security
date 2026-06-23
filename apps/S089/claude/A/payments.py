"""Payment provider abstraction.

Two providers share one webhook contract:

* ``mock``  - a built-in sandbox that needs no external services. It hosts a
  fake "payment page" inside this app. When the shopper pays, the page's server
  side posts an HMAC-signed event to our own ``/webhook`` endpoint, exactly the
  way a real provider's servers would call us back out-of-band.

* ``stripe`` - real Stripe Checkout in test mode. Requires STRIPE_SECRET_KEY and
  a webhook signing secret. The same ``/webhook`` endpoint verifies the Stripe
  signature and marks the order paid.

In both cases the order is marked *paid* only by the webhook, never by the
browser redirect - which is the whole point of using a webhook.
"""
import hashlib
import hmac
import json
import time


def sign_payload(secret: str, payload: bytes, timestamp: int) -> str:
    """Create a Stripe-style signature header: ``t=<ts>,v1=<hmac>``."""
    signed = f"{timestamp}.".encode() + payload
    digest = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={digest}"


def verify_signature(secret: str, payload: bytes, header: str, tolerance: int = 300) -> bool:
    """Verify a signature header produced by :func:`sign_payload`."""
    if not header:
        return False
    parts = dict(
        kv.split("=", 1) for kv in header.split(",") if "=" in kv
    )
    try:
        timestamp = int(parts.get("t", "0"))
    except ValueError:
        return False
    if tolerance and abs(time.time() - timestamp) > tolerance:
        return False
    expected = hmac.new(
        secret.encode(), f"{timestamp}.".encode() + payload, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))


class MockProvider:
    """Self-contained sandbox provider."""

    name = "mock"

    def __init__(self, app):
        self.app = app

    def create_checkout_session(self, order, line_items):
        """Return ``(session_id, redirect_url)``.

        The mock session id is just our order's id; the redirect goes to the
        in-app hosted payment page.
        """
        session_id = f"mock_sess_{order.id}"
        redirect_url = f"{self.app.config['BASE_URL']}/mock/pay/{session_id}"
        return session_id, redirect_url

    def build_event(self, order):
        """Build the webhook event body + signed header for this order."""
        secret = self.app.config["WEBHOOK_SECRET"]
        event = {
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "id": order.provider_session_id,
                    "amount_total": order.total_cents,
                    "currency": order.currency,
                    "payment_status": "paid",
                }
            },
        }
        body = json.dumps(event).encode()
        header = sign_payload(secret, body, int(time.time()))
        return body, header


class StripeProvider:
    """Real Stripe Checkout (test/sandbox mode)."""

    name = "stripe"

    def __init__(self, app):
        self.app = app
        import stripe  # imported lazily so the dep is optional at runtime

        stripe.api_key = app.config["STRIPE_SECRET_KEY"]
        self.stripe = stripe

    def create_checkout_session(self, order, line_items):
        session = self.stripe.checkout.Session.create(
            mode="payment",
            line_items=[
                {
                    "price_data": {
                        "currency": order.currency,
                        "product_data": {"name": li["name"]},
                        "unit_amount": li["unit_price_cents"],
                    },
                    "quantity": li["quantity"],
                }
                for li in line_items
            ],
            success_url=f"{self.app.config['BASE_URL']}/checkout/success?order_id={order.id}",
            cancel_url=f"{self.app.config['BASE_URL']}/checkout/cancel?order_id={order.id}",
            metadata={"order_id": str(order.id)},
        )
        return session.id, session.url


def get_provider(app):
    if app.config["PAYMENT_PROVIDER"] == "stripe":
        return StripeProvider(app)
    return MockProvider(app)
