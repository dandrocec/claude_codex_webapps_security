"""Built-in payment sandbox.

This stands in for an external payment provider's hosted checkout page so the
app runs with zero external setup. Choosing "Pay" delivers a properly signed
webhook to /webhook (server-to-server), exactly like a real provider would.
Only enabled when PAYMENT_PROVIDER=sandbox.
"""
import logging

from flask import (
    Blueprint, render_template, redirect, url_for, abort, current_app, flash,
)
from flask_login import login_required, current_user

from forms import CSRFOnlyForm
from models import get_order_by_payment_ref, get_order_items
from payments import build_sandbox_event

log = logging.getLogger(__name__)
bp = Blueprint("sandbox", __name__, url_prefix="/sandbox")


def _require_sandbox():
    if current_app.config["PAYMENT_PROVIDER"] != "sandbox":
        abort(404)


@bp.route("/pay/<payment_ref>", methods=["GET"])
@login_required
def pay(payment_ref):
    _require_sandbox()
    order = get_order_by_payment_ref(payment_ref)
    # Only the order's owner may open its payment page (prevents IDOR).
    if order is None or order["user_id"] != current_user.id:
        abort(404)
    return render_template(
        "sandbox_pay.html", order=order,
        items=get_order_items(order["id"]), form=CSRFOnlyForm(),
    )


@bp.route("/pay/<payment_ref>", methods=["POST"])
@login_required
def confirm(payment_ref):
    _require_sandbox()
    form = CSRFOnlyForm()
    if not form.validate_on_submit():
        abort(400)
    order = get_order_by_payment_ref(payment_ref)
    if order is None or order["user_id"] != current_user.id:
        abort(404)

    # Deliver a signed webhook to our own /webhook endpoint, in-process via the
    # WSGI test client. This exercises the real signature-verification path the
    # same way an external provider's callback would, without depending on a
    # multi-threaded dev server or an outbound network call to ourselves.
    payload, signature = build_sandbox_event(payment_ref)
    resp = current_app.test_client().post(
        url_for("main.webhook"),
        data=payload,
        headers={"Content-Type": "application/json", "X-Signature": signature},
    )
    if resp.status_code != 200:
        log.error("Sandbox webhook delivery returned %s", resp.status_code)
        flash("Payment processing failed. Please try again.", "error")
        return redirect(url_for("main.orders"))

    return redirect(url_for("main.checkout_success", ref=payment_ref))
