"""Admin-only order listing."""
from functools import wraps

from flask import Blueprint, render_template, abort
from flask_login import login_required, current_user

from models import list_all_orders, get_order, get_order_items

bp = Blueprint("admin", __name__, url_prefix="/admin")


def admin_required(view):
    @wraps(view)
    @login_required
    def wrapped(*args, **kwargs):
        if not current_user.is_admin:
            abort(403)
        return view(*args, **kwargs)
    return wrapped


@bp.route("/orders")
@admin_required
def orders():
    return render_template("admin_orders.html", orders=list_all_orders())


@bp.route("/orders/<int:order_id>")
@admin_required
def order_detail(order_id):
    order = get_order(order_id)
    if order is None:
        abort(404)
    return render_template(
        "order_detail.html", order=order,
        items=get_order_items(order_id), admin_view=True,
    )
