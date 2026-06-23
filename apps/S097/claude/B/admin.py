"""Admin back office: manage products, inventory and orders."""
from decimal import Decimal, ROUND_HALF_UP

from flask import Blueprint, render_template, redirect, url_for, flash, abort

import models
from auth import admin_required
from forms import ProductForm, OrderStatusForm

bp = Blueprint("admin", __name__, url_prefix="/admin")


def _price_to_cents(price: Decimal) -> int:
    cents = (price * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(cents)


@bp.route("/")
@admin_required
def dashboard():
    products = models.list_products(active_only=False)
    orders = models.list_all_orders()
    return render_template(
        "admin/dashboard.html", products=products, orders=orders
    )


# --------------------------------------------------------------------------
# Products / inventory
# --------------------------------------------------------------------------
@bp.route("/products")
@admin_required
def products():
    rows = models.list_products(active_only=False)
    return render_template("admin/products.html", products=rows)


@bp.route("/products/new", methods=["GET", "POST"])
@admin_required
def new_product():
    form = ProductForm()
    if form.validate_on_submit():
        models.create_product(
            form.name.data.strip(),
            form.description.data or "",
            _price_to_cents(form.price.data),
            form.stock.data,
        )
        flash("Product created.", "success")
        return redirect(url_for("admin.products"))
    return render_template("admin/product_form.html", form=form, mode="new")


@bp.route("/products/<int:product_id>/edit", methods=["GET", "POST"])
@admin_required
def edit_product(product_id):
    product = models.get_product(product_id)
    if product is None:
        abort(404)

    form = ProductForm(data={
        "name": product["name"],
        "description": product["description"],
        "price": Decimal(product["price_cents"]) / 100,
        "stock": product["stock"],
        "is_active": bool(product["is_active"]),
    })

    if form.validate_on_submit():
        models.update_product(
            product_id,
            form.name.data.strip(),
            form.description.data or "",
            _price_to_cents(form.price.data),
            form.stock.data,
            form.is_active.data,
        )
        flash("Product updated.", "success")
        return redirect(url_for("admin.products"))

    return render_template(
        "admin/product_form.html", form=form, mode="edit", product=product
    )


# --------------------------------------------------------------------------
# Orders
# --------------------------------------------------------------------------
@bp.route("/orders")
@admin_required
def orders():
    rows = models.list_all_orders()
    return render_template("admin/orders.html", orders=rows)


@bp.route("/orders/<int:order_id>", methods=["GET", "POST"])
@admin_required
def order_detail(order_id):
    order = models.get_order_any(order_id)
    if order is None:
        abort(404)
    items = models.get_order_items(order_id)
    form = OrderStatusForm(data={"status": order["status"]})

    if form.validate_on_submit():
        try:
            models.update_order_status(order_id, form.status.data)
        except ValueError:
            abort(400)
        flash("Order status updated.", "success")
        return redirect(url_for("admin.order_detail", order_id=order_id))

    return render_template(
        "admin/order_detail.html", order=order, items=items, form=form
    )
