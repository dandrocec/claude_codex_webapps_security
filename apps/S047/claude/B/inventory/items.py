"""Inventory item management. Every query is scoped to the current user (IDOR-safe)."""
from __future__ import annotations

import sqlite3

from flask import (
    Blueprint,
    abort,
    flash,
    redirect,
    render_template,
    request,
    url_for,
)
from flask_login import current_user, login_required

from .db import get_db
from .forms import AdjustForm, ItemForm

bp = Blueprint("items", __name__)


def _get_owned_item(item_id: int):
    """Fetch an item only if it belongs to the current user, else 404."""
    db = get_db()
    row = db.execute(
        "SELECT * FROM items WHERE id = ? AND user_id = ?",
        (item_id, current_user.id),
    ).fetchone()
    if row is None:
        abort(404)
    return row


@bp.route("/items")
@login_required
def index():
    search = (request.args.get("q") or "").strip()
    db = get_db()
    if search:
        # Parameterised LIKE; escape wildcards so user input can't widen the match.
        pattern = "%" + search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        rows = db.execute(
            "SELECT * FROM items "
            "WHERE user_id = ? AND (name LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\') "
            "ORDER BY name COLLATE NOCASE",
            (current_user.id, pattern, pattern),
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM items WHERE user_id = ? ORDER BY name COLLATE NOCASE",
            (current_user.id,),
        ).fetchall()
    return render_template("items/index.html", items=rows, search=search)


@bp.route("/items/new", methods=["GET", "POST"])
@login_required
def create():
    form = ItemForm()
    if form.validate_on_submit():
        db = get_db()
        try:
            db.execute(
                "INSERT INTO items (user_id, name, sku, quantity, location, low_stock_threshold) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    current_user.id,
                    form.name.data.strip(),
                    form.sku.data.strip(),
                    form.quantity.data,
                    (form.location.data or "").strip(),
                    form.low_stock_threshold.data,
                ),
            )
            db.commit()
        except sqlite3.IntegrityError:
            flash("You already have an item with that SKU.", "error")
            return render_template("items/form.html", form=form, mode="create")
        flash("Item added.", "success")
        return redirect(url_for("items.index"))
    return render_template("items/form.html", form=form, mode="create")


@bp.route("/items/<int:item_id>/edit", methods=["GET", "POST"])
@login_required
def edit(item_id: int):
    item = _get_owned_item(item_id)
    form = ItemForm(data=dict(item))
    if form.validate_on_submit():
        db = get_db()
        try:
            db.execute(
                "UPDATE items SET name = ?, sku = ?, quantity = ?, location = ?, "
                "low_stock_threshold = ?, updated_at = CURRENT_TIMESTAMP "
                "WHERE id = ? AND user_id = ?",
                (
                    form.name.data.strip(),
                    form.sku.data.strip(),
                    form.quantity.data,
                    (form.location.data or "").strip(),
                    form.low_stock_threshold.data,
                    item_id,
                    current_user.id,
                ),
            )
            db.commit()
        except sqlite3.IntegrityError:
            flash("You already have an item with that SKU.", "error")
            return render_template("items/form.html", form=form, mode="edit", item=item)
        flash("Item updated.", "success")
        return redirect(url_for("items.index"))
    return render_template("items/form.html", form=form, mode="edit", item=item)


@bp.route("/items/<int:item_id>/adjust", methods=["POST"])
@login_required
def adjust(item_id: int):
    item = _get_owned_item(item_id)
    form = AdjustForm()
    if form.validate_on_submit():
        new_qty = item["quantity"] + form.delta.data
        if new_qty < 0:
            new_qty = 0
        db = get_db()
        db.execute(
            "UPDATE items SET quantity = ?, updated_at = CURRENT_TIMESTAMP "
            "WHERE id = ? AND user_id = ?",
            (new_qty, item_id, current_user.id),
        )
        db.commit()
        flash("Quantity updated.", "success")
    else:
        flash("Invalid adjustment.", "error")
    return redirect(url_for("items.index", q=request.args.get("q", "")))


@bp.route("/items/<int:item_id>/delete", methods=["POST"])
@login_required
def delete(item_id: int):
    _get_owned_item(item_id)  # ensures ownership or 404
    db = get_db()
    db.execute(
        "DELETE FROM items WHERE id = ? AND user_id = ?",
        (item_id, current_user.id),
    )
    db.commit()
    flash("Item deleted.", "success")
    return redirect(url_for("items.index"))
