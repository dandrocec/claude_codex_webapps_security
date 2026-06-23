"""Payment provider integration.

Two providers are supported:

* "sandbox" (default) - a self-contained sandbox that mimics a real provider's
  hosted-checkout + signed-webhook flow without needing an external account, so
  the app is fully runnable out of the box. The webhook it sends is signed with
  HMAC-SHA256 using WEBHOOK_SECRET, in the same `t=...,v1=...` style Stripe uses.
* "stripe" - real Stripe Checkout in test mode (set STRIPE_SECRET_KEY).

In both cases the order is only marked paid when a webhook with a valid
signature is received and verified server-side.
"""
import hmac
import hashlib
import time
import json
import secrets

from flask import current_app, url_for


# ---- Signature helpers (shared by sandbox provider + webhook verify) --------

def sign_payload(payload: bytes, secret: str, timestamp: int | None = None) -> str:
    timestamp = timestamp or int(time.time())
    signed = f"{timestamp}.".encode("utf-8") + payload
    digest = hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={digest}"


def verify_signature(payload: bytes, header: str, secret: str,
                     tolerance: int = 300) -> bool:
    if not header:
        return False
    try:
        parts = dict(p.split("=", 1) for p in header.split(","))
        timestamp = int(parts["t"])
        provided = parts["v1"]
    except (ValueError, KeyError):
        return False
    # Reject stale signatures (replay protection).
    if abs(time.time() - timestamp) > tolerance:
        return False
    signed = f"{timestamp}.".encode("utf-8") + payload
    expected = hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, provided)


def new_payment_ref() -> str:
    return "pay_" + secrets.token_urlsafe(24)


# ---- Provider dispatch ------------------------------------------------------

def start_checkout(order, items) -> str:
    """Return the URL the customer should be redirected to in order to pay."""
    provider = current_app.config["PAYMENT_PROVIDER"]
    if provider == "stripe":
        return _start_stripe_checkout(order, items)
    return _start_sandbox_checkout(order)


def _start_sandbox_checkout(order) -> str:
    # The hosted payment page lives inside this app under the sandbox blueprint.
    return url_for("sandbox.pay", payment_ref=order["payment_ref"], _external=True)


def _start_stripe_checkout(order, items) -> str:
    import stripe

    stripe.api_key = current_app.config["STRIPE_SECRET_KEY"]
    session = stripe.checkout.Session.create(
        mode="payment",
        line_items=[
            {
                "price_data": {
                    "currency": order["currency"],
                    "product_data": {"name": it["product_name"]},
                    "unit_amount": it["unit_cents"],
                },
                "quantity": it["quantity"],
            }
            for it in items
        ],
        client_reference_id=str(order["id"]),
        metadata={"payment_ref": order["payment_ref"]},
        success_url=current_app.config["BASE_URL"]
        + "/checkout/success?ref=" + order["payment_ref"],
        cancel_url=current_app.config["BASE_URL"] + "/checkout/cancel",
    )
    return session.url


def build_sandbox_event(payment_ref: str) -> tuple[bytes, str]:
    """Construct a signed `payment.succeeded` event for the sandbox provider."""
    payload = json.dumps({
        "id": "evt_" + secrets.token_urlsafe(16),
        "type": "payment.succeeded",
        "created": int(time.time()),
        "data": {"payment_ref": payment_ref},
    }).encode("utf-8")
    signature = sign_payload(payload, current_app.config["WEBHOOK_SECRET"])
    return payload, signature
