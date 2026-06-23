"""Storefront: browsing, cart, checkout, order history and the webhook."""
import json
import logging

from flask import (
    Blueprint, render_template, redirect, url_for, flash, request,
    session, abort, current_app, jsonify,
)
from flask_login import login_required, current_user

from forms import AddToCartForm, UpdateCartForm, CSRFOnlyForm
from models import (
    list_products, get_product, create_order, set_order_payment_ref,
    get_order_for_user, get_order_items, list_orders_for_user,
    get_order_by_payment_ref, mark_order_paid,
)
from payments import start_checkout, verify_signature, new_payment_ref

log = logging.getLogger(__name__)
bp = Blueprint("main", __name__)

CART_KEY = "cart"


# ---- Cart helpers -----------------------------------------------------------

def _get_cart() -> dict:
    return session.get(CART_KEY, {})


def _save_cart(cart: dict) -> None:
    session[CART_KEY] = cart
    session.modified = True


def _cart_items(cart: dict):
    """Resolve the session cart into (product_row, qty) pairs using live prices."""
    items = []
    for pid_str, qty in cart.items():
        product = get_product(int(pid_str))
        if product is not None:
            items.append((product, qty))
    return items


# ---- Browsing ---------------------------------------------------------------

@bp.route("/")
def index():
    return render_template("index.html", products=list_products())


@bp.route("/product/<int:product_id>")
def product(product_id):
    product = get_product(product_id)
    if product is None:
        abort(404)
    return render_template("product.html", product=product, form=AddToCartForm())


# ---- Cart -------------------------------------------------------------------

@bp.route("/cart")
def cart():
    items = _cart_items(_get_cart())
    total = sum(p["price_cents"] * qty for p, qty in items)
    return render_template(
        "cart.html", items=items, total=total,
        update_form=UpdateCartForm(), checkout_form=CSRFOnlyForm(),
    )


@bp.route("/cart/add", methods=["POST"])
def cart_add():
    form = AddToCartForm()
    if not form.validate_on_submit():
        flash("Invalid cart request.", "error")
        return redirect(url_for("main.index"))
    product = get_product(int(form.product_id.data))
    if product is None:
        abort(404)
    cart = _get_cart()
    pid = str(product["id"])
    new_qty = cart.get(pid, 0) + form.quantity.data
    cart[pid] = min(new_qty, 99)
    _save_cart(cart)
    flash(f"Added {product['name']} to cart.", "success")
    return redirect(url_for("main.cart"))


@bp.route("/cart/update", methods=["POST"])
def cart_update():
    form = UpdateCartForm()
    if not form.validate_on_submit():
        flash("Invalid cart request.", "error")
        return redirect(url_for("main.cart"))
    cart = _get_cart()
    pid = str(int(form.product_id.data))
    if form.quantity.data == 0:
        cart.pop(pid, None)
    elif pid in cart:
        cart[pid] = form.quantity.data
    _save_cart(cart)
    return redirect(url_for("main.cart"))


# ---- Checkout ---------------------------------------------------------------

@bp.route("/checkout", methods=["POST"])
@login_required
def checkout():
    form = CSRFOnlyForm()
    if not form.validate_on_submit():
        abort(400)
    items = _cart_items(_get_cart())
    if not items:
        flash("Your cart is empty.", "error")
        return redirect(url_for("main.cart"))

    # Prices come from the DB inside create_order, never from the client.
    order_id = create_order(current_user.id, items, current_app.config["CURRENCY"])
    payment_ref = new_payment_ref()
    set_order_payment_ref(order_id, payment_ref)

    order = get_order_for_user(order_id, current_user.id)
    order_items = get_order_items(order_id)
    try:
        redirect_url = start_checkout(order, order_items)
    except Exception:  # provider/network failure
        log.exception("Failed to start checkout for order %s", order_id)
        flash("Unable to start payment right now. Please try again.", "error")
        return redirect(url_for("main.cart"))

    # Cart is cleared; the pending order now represents the purchase.
    _save_cart({})
    return redirect(redirect_url)


@bp.route("/checkout/success")
@login_required
def checkout_success():
    ref = request.args.get("ref", "")
    order = get_order_by_payment_ref(ref) if ref else None
    # Ownership check prevents viewing someone else's order via its ref.
    if order is None or order["user_id"] != current_user.id:
        return render_template("checkout_result.html", paid=None)
    return render_template(
        "checkout_result.html", paid=(order["status"] == "paid"), order=order,
    )


@bp.route("/checkout/cancel")
@login_required
def checkout_cancel():
    flash("Payment was cancelled. Your order is still pending.", "error")
    return redirect(url_for("main.orders"))


# ---- Order history ----------------------------------------------------------

@bp.route("/orders")
@login_required
def orders():
    return render_template(
        "orders.html", orders=list_orders_for_user(current_user.id)
    )


@bp.route("/orders/<int:order_id>")
@login_required
def order_detail(order_id):
    # Scoped to the current user -> a user can never read another's order (IDOR).
    order = get_order_for_user(order_id, current_user.id)
    if order is None:
        abort(404)
    return render_template(
        "order_detail.html", order=order, items=get_order_items(order_id),
    )


# ---- Payment webhook --------------------------------------------------------

@bp.route("/webhook", methods=["POST"])
def webhook():
    """Receive payment provider events. CSRF-exempt (see app factory); instead
    authenticity is enforced by verifying the HMAC signature header."""
    payload = request.get_data()  # raw bytes, required for signature check
    provider = current_app.config["PAYMENT_PROVIDER"]

    if provider == "stripe":
        return _handle_stripe_webhook(payload)
    return _handle_sandbox_webhook(payload)


def _handle_sandbox_webhook(payload: bytes):
    signature = request.headers.get("X-Signature", "")
    if not verify_signature(payload, signature,
                            current_app.config["WEBHOOK_SECRET"]):
        log.warning("Rejected webhook with invalid signature")
        abort(400)
    try:
        event = json.loads(payload)
    except ValueError:
        abort(400)
    if event.get("type") == "payment.succeeded":
        ref = event.get("data", {}).get("payment_ref")
        _fulfil(ref)
    return jsonify(received=True)


def _handle_stripe_webhook(payload: bytes):
    import stripe

    sig = request.headers.get("Stripe-Signature", "")
    try:
        event = stripe.Webhook.construct_event(
            payload, sig, current_app.config["STRIPE_WEBHOOK_SECRET"]
        )
    except (ValueError, stripe.error.SignatureVerificationError):
        log.warning("Rejected Stripe webhook with invalid signature")
        abort(400)
    if event["type"] == "checkout.session.completed":
        ref = event["data"]["object"].get("metadata", {}).get("payment_ref")
        _fulfil(ref)
    return jsonify(received=True)


def _fulfil(payment_ref):
    if not payment_ref:
        return
    order = get_order_by_payment_ref(payment_ref)
    if order is None:
        return
    if mark_order_paid(order["id"]):
        log.info("Order %s marked paid", order["id"])
