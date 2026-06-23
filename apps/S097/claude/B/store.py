"""Customer storefront: browse, cart, checkout, reviews, order history."""
from decimal import Decimal

from flask import (
    Blueprint, render_template, redirect, url_for, flash, request, abort
)
from flask_login import login_required, current_user

import models
from forms import AddToCartForm, UpdateCartForm, CheckoutForm, ReviewForm

bp = Blueprint("store", __name__)


@bp.route("/")
def index():
    products = models.list_products(active_only=True)
    return render_template("store/index.html", products=products)


@bp.route("/product/<int:product_id>")
def product_detail(product_id):
    product = models.get_product(product_id, active_only=True)
    if product is None:
        abort(404)
    reviews = models.list_reviews(product_id)
    cart_form = AddToCartForm()
    review_form = ReviewForm()

    can_review = False
    existing_review = None
    if current_user.is_authenticated:
        can_review = models.user_has_purchased(current_user.id, product_id)
        existing_review = models.get_user_review(product_id, current_user.id)
        if existing_review:
            review_form.rating.data = str(existing_review["rating"])
            review_form.body.data = existing_review["body"]

    return render_template(
        "store/product.html",
        product=product,
        reviews=reviews,
        cart_form=cart_form,
        review_form=review_form,
        can_review=can_review,
        existing_review=existing_review,
    )


@bp.route("/product/<int:product_id>/review", methods=["POST"])
@login_required
def submit_review(product_id):
    product = models.get_product(product_id, active_only=True)
    if product is None:
        abort(404)

    # Access control: only buyers may review.
    if not models.user_has_purchased(current_user.id, product_id):
        abort(403)

    form = ReviewForm()
    if form.validate_on_submit():
        rating = int(form.rating.data)  # constrained by SelectField choices
        models.upsert_review(product_id, current_user.id, rating, form.body.data or "")
        flash("Thanks for your review!", "success")
    else:
        flash("Could not save your review. Check the form and try again.", "error")
    return redirect(url_for("store.product_detail", product_id=product_id))


# --------------------------------------------------------------------------
# Cart
# --------------------------------------------------------------------------
@bp.route("/cart")
@login_required
def cart():
    rows = models.get_cart_rows(current_user.id)
    subtotal = sum(r["price_cents"] * r["quantity"] for r in rows)
    update_form = UpdateCartForm()
    return render_template(
        "store/cart.html", rows=rows, subtotal=subtotal, update_form=update_form
    )


@bp.route("/product/<int:product_id>/add", methods=["POST"])
@login_required
def add_to_cart(product_id):
    product = models.get_product(product_id, active_only=True)
    if product is None:
        abort(404)

    form = AddToCartForm()
    if not form.validate_on_submit():
        flash("Invalid quantity.", "error")
        return redirect(url_for("store.product_detail", product_id=product_id))

    qty = form.quantity.data
    if qty > product["stock"]:
        flash("Not enough stock available.", "error")
        return redirect(url_for("store.product_detail", product_id=product_id))

    models.add_to_cart(current_user.id, product_id, qty)
    flash("Added to cart.", "success")
    return redirect(url_for("store.cart"))


@bp.route("/cart/<int:cart_id>/update", methods=["POST"])
@login_required
def update_cart(cart_id):
    form = UpdateCartForm()
    if not form.validate_on_submit():
        flash("Invalid quantity.", "error")
        return redirect(url_for("store.cart"))
    # set_cart_quantity scopes the update to current_user → IDOR-safe.
    models.set_cart_quantity(current_user.id, cart_id, form.quantity.data or 0)
    return redirect(url_for("store.cart"))


@bp.route("/cart/<int:cart_id>/remove", methods=["POST"])
@login_required
def remove_from_cart(cart_id):
    models.remove_cart_item(current_user.id, cart_id)
    flash("Item removed.", "success")
    return redirect(url_for("store.cart"))


# --------------------------------------------------------------------------
# Checkout & orders
# --------------------------------------------------------------------------
@bp.route("/checkout", methods=["GET", "POST"])
@login_required
def checkout():
    rows = models.get_cart_rows(current_user.id)
    if not rows:
        flash("Your cart is empty.", "error")
        return redirect(url_for("store.cart"))

    subtotal = sum(r["price_cents"] * r["quantity"] for r in rows)
    form = CheckoutForm()
    if request.method == "GET":
        form.shipping_name.data = current_user.name

    if form.validate_on_submit():
        try:
            order_id = models.place_order(
                current_user.id,
                form.shipping_name.data.strip(),
                form.shipping_address.data.strip(),
            )
        except models.CheckoutError as exc:
            flash(str(exc), "error")
            return redirect(url_for("store.cart"))

        flash("Order placed successfully!", "success")
        return redirect(url_for("store.order_detail", order_id=order_id))

    return render_template(
        "store/checkout.html", rows=rows, subtotal=subtotal, form=form
    )


@bp.route("/orders")
@login_required
def orders():
    rows = models.list_orders_for_user(current_user.id)
    return render_template("store/orders.html", orders=rows)


@bp.route("/orders/<int:order_id>")
@login_required
def order_detail(order_id):
    # Only the owning user can load the order (prevents IDOR).
    order = models.get_order_for_user(order_id, current_user.id)
    if order is None:
        abort(404)
    items = models.get_order_items(order_id)
    return render_template("store/order_detail.html", order=order, items=items)
