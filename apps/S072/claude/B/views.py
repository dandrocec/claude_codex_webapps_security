"""Application content routes: home, premium, profile, admin."""
from flask import (Blueprint, abort, flash, g, redirect, render_template,
                   url_for)

import db
from forms import ChangeTierForm, ProfileForm
from security import admin_required, login_required, premium_required

bp = Blueprint("main", __name__)


@bp.route("/")
def index():
    return render_template("index.html")


@bp.route("/premium")
@premium_required
def premium():
    return render_template("premium.html")


@bp.route("/profile", methods=["GET", "POST"])
@login_required
def profile():
    # Access control: the only resource a user can edit here is their own
    # account, taken from the session — never from a client-supplied id
    # (prevents IDOR, OWASP A01).
    form = ProfileForm(display_name=g.user["display_name"])
    if form.validate_on_submit():
        db.update_display_name(g.user["id"], form.display_name.data.strip())
        flash("Profile updated.", "success")
        return redirect(url_for("main.profile"))
    return render_template("profile.html", form=form)


@bp.route("/admin")
@admin_required
def admin():
    return render_template(
        "admin.html", users=db.list_users(), form=ChangeTierForm()
    )


@bp.route("/admin/change-tier", methods=["POST"])
@admin_required
def change_tier():
    form = ChangeTierForm()
    if not form.validate_on_submit():
        flash("Invalid request.", "error")
        return redirect(url_for("main.admin"))

    try:
        target_id = int(form.user_id.data)
    except (TypeError, ValueError):
        abort(400)

    target = db.get_user_by_id(target_id)
    if target is None:
        flash("That user no longer exists.", "error")
        return redirect(url_for("main.admin"))

    # Guard rail: an admin cannot demote/alter their own tier here, which
    # avoids accidental self-lockout scenarios.
    if target_id == g.user["id"]:
        flash("You cannot change your own tier from this panel.", "error")
        return redirect(url_for("main.admin"))

    db.set_user_tier(target_id, form.tier.data)
    flash(f"Updated {target['display_name']} to {form.tier.data}.", "success")
    return redirect(url_for("main.admin"))
