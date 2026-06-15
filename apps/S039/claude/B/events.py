"""Event routes: public listing, detail view and organiser CRUD."""
from datetime import date

from flask import Blueprint, abort, flash, redirect, render_template, url_for
from flask_login import current_user, login_required

from db import get_db
from forms import EventForm

bp = Blueprint("events", __name__)


def _get_event_or_404(event_id):
    row = get_db().execute(
        """SELECT e.id, e.title, e.event_date, e.location, e.description,
                  e.organiser_id, u.username AS organiser_name
           FROM events e JOIN users u ON u.id = e.organiser_id
           WHERE e.id = ?""",
        (event_id,),
    ).fetchone()
    if row is None:
        abort(404)
    return row


def _require_owner(event):
    """Access control: only the organiser may modify their own event."""
    if event["organiser_id"] != current_user.id:
        abort(403)


@bp.route("/")
def index():
    """Public page: upcoming events sorted by date (soonest first)."""
    events = get_db().execute(
        """SELECT e.id, e.title, e.event_date, e.location, u.username AS organiser_name
           FROM events e JOIN users u ON u.id = e.organiser_id
           WHERE e.event_date >= ?
           ORDER BY e.event_date ASC, e.title ASC""",
        (date.today().isoformat(),),
    ).fetchall()
    return render_template("index.html", events=events)


@bp.route("/events/<int:event_id>")
def detail(event_id):
    event = _get_event_or_404(event_id)
    return render_template("detail.html", event=event)


@bp.route("/dashboard")
@login_required
def dashboard():
    events = get_db().execute(
        """SELECT id, title, event_date, location
           FROM events WHERE organiser_id = ?
           ORDER BY event_date ASC""",
        (current_user.id,),
    ).fetchall()
    return render_template("dashboard.html", events=events)


@bp.route("/events/new", methods=["GET", "POST"])
@login_required
def create():
    form = EventForm()
    if form.validate_on_submit():
        db = get_db()
        db.execute(
            """INSERT INTO events (title, event_date, location, description, organiser_id)
               VALUES (?, ?, ?, ?, ?)""",
            (
                form.title.data,
                form.event_date.data.isoformat(),
                form.location.data,
                form.description.data,
                current_user.id,
            ),
        )
        db.commit()
        flash("Event created.", "success")
        return redirect(url_for("events.dashboard"))
    return render_template("event_form.html", form=form, heading="New event")


@bp.route("/events/<int:event_id>/edit", methods=["GET", "POST"])
@login_required
def edit(event_id):
    event = _get_event_or_404(event_id)
    _require_owner(event)
    form = EventForm(data={
        "title": event["title"],
        "event_date": date.fromisoformat(event["event_date"]),
        "location": event["location"],
        "description": event["description"],
    })
    if form.validate_on_submit():
        db = get_db()
        db.execute(
            """UPDATE events
               SET title = ?, event_date = ?, location = ?, description = ?
               WHERE id = ? AND organiser_id = ?""",
            (
                form.title.data,
                form.event_date.data.isoformat(),
                form.location.data,
                form.description.data,
                event_id,
                current_user.id,
            ),
        )
        db.commit()
        flash("Event updated.", "success")
        return redirect(url_for("events.dashboard"))
    return render_template("event_form.html", form=form, heading="Edit event")


@bp.route("/events/<int:event_id>/delete", methods=["POST"])
@login_required
def delete(event_id):
    event = _get_event_or_404(event_id)
    _require_owner(event)
    db = get_db()
    db.execute(
        "DELETE FROM events WHERE id = ? AND organiser_id = ?",
        (event_id, current_user.id),
    )
    db.commit()
    flash("Event deleted.", "success")
    return redirect(url_for("events.dashboard"))
