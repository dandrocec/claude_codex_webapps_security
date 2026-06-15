"""Flask newsletter manager.

A single logged-in editor manages a list of subscribers and composes
newsletter drafts (subject + body). Drafts can be previewed as they would
appear when sent. Data is stored in SQLite.
"""

import os
import sqlite3
from datetime import datetime, timezone
from functools import wraps

from flask import (
    Flask,
    abort,
    flash,
    g,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.path.join(BASE_DIR, "newsletter.db")

app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.environ.get("SECRET_KEY", "dev-secret-change-me"),
    DATABASE=DATABASE,
)

# Editor credentials. Override with env vars in real deployments.
EDITOR_USERNAME = os.environ.get("EDITOR_USERNAME", "editor")
EDITOR_PASSWORD_HASH = generate_password_hash(
    os.environ.get("EDITOR_PASSWORD", "changeme")
)


# --------------------------------------------------------------------------- #
# Database helpers
# --------------------------------------------------------------------------- #
def get_db():
    """Return a request-scoped SQLite connection."""
    if "db" not in g:
        g.db = sqlite3.connect(app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """Create tables if they do not exist yet."""
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS subscribers (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            email      TEXT NOT NULL UNIQUE,
            name       TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS drafts (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            subject    TEXT NOT NULL DEFAULT '',
            body       TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """
    )
    db.commit()


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


# --------------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------------- #
def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("logged_in"):
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped


@app.route("/login", methods=["GET", "POST"])
def login():
    if session.get("logged_in"):
        return redirect(url_for("dashboard"))

    if request.method == "POST":
        username = request.form.get("username", "")
        password = request.form.get("password", "")
        if username == EDITOR_USERNAME and check_password_hash(
            EDITOR_PASSWORD_HASH, password
        ):
            session.clear()
            session["logged_in"] = True
            session["username"] = username
            flash("Welcome back!", "success")
            next_url = request.args.get("next")
            return redirect(next_url or url_for("dashboard"))
        flash("Invalid username or password.", "error")

    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    flash("You have been logged out.", "success")
    return redirect(url_for("login"))


# --------------------------------------------------------------------------- #
# Dashboard
# --------------------------------------------------------------------------- #
@app.route("/")
@login_required
def dashboard():
    db = get_db()
    sub_count = db.execute("SELECT COUNT(*) AS n FROM subscribers").fetchone()["n"]
    draft_count = db.execute("SELECT COUNT(*) AS n FROM drafts").fetchone()["n"]
    recent_drafts = db.execute(
        "SELECT * FROM drafts ORDER BY updated_at DESC LIMIT 5"
    ).fetchall()
    return render_template(
        "dashboard.html",
        sub_count=sub_count,
        draft_count=draft_count,
        recent_drafts=recent_drafts,
    )


# --------------------------------------------------------------------------- #
# Subscribers
# --------------------------------------------------------------------------- #
@app.route("/subscribers")
@login_required
def subscribers():
    db = get_db()
    rows = db.execute(
        "SELECT * FROM subscribers ORDER BY created_at DESC"
    ).fetchall()
    return render_template("subscribers.html", subscribers=rows)


@app.route("/subscribers/add", methods=["POST"])
@login_required
def add_subscriber():
    email = request.form.get("email", "").strip()
    name = request.form.get("name", "").strip()

    if not email or "@" not in email:
        flash("Please enter a valid email address.", "error")
        return redirect(url_for("subscribers"))

    db = get_db()
    try:
        db.execute(
            "INSERT INTO subscribers (email, name, created_at) VALUES (?, ?, ?)",
            (email, name, now_iso()),
        )
        db.commit()
        flash(f"Subscriber {email} added.", "success")
    except sqlite3.IntegrityError:
        flash(f"{email} is already subscribed.", "error")

    return redirect(url_for("subscribers"))


@app.route("/subscribers/<int:sub_id>/delete", methods=["POST"])
@login_required
def delete_subscriber(sub_id):
    db = get_db()
    db.execute("DELETE FROM subscribers WHERE id = ?", (sub_id,))
    db.commit()
    flash("Subscriber removed.", "success")
    return redirect(url_for("subscribers"))


# --------------------------------------------------------------------------- #
# Drafts
# --------------------------------------------------------------------------- #
@app.route("/drafts")
@login_required
def drafts():
    db = get_db()
    rows = db.execute("SELECT * FROM drafts ORDER BY updated_at DESC").fetchall()
    return render_template("drafts.html", drafts=rows)


@app.route("/drafts/new", methods=["GET", "POST"])
@login_required
def new_draft():
    if request.method == "POST":
        subject = request.form.get("subject", "").strip()
        body = request.form.get("body", "")
        ts = now_iso()
        db = get_db()
        cur = db.execute(
            "INSERT INTO drafts (subject, body, created_at, updated_at) "
            "VALUES (?, ?, ?, ?)",
            (subject, body, ts, ts),
        )
        db.commit()
        flash("Draft created.", "success")
        return redirect(url_for("edit_draft", draft_id=cur.lastrowid))

    return render_template("draft_edit.html", draft=None)


def _get_draft_or_404(draft_id):
    draft = (
        get_db()
        .execute("SELECT * FROM drafts WHERE id = ?", (draft_id,))
        .fetchone()
    )
    if draft is None:
        abort(404)
    return draft


@app.route("/drafts/<int:draft_id>/edit", methods=["GET", "POST"])
@login_required
def edit_draft(draft_id):
    draft = _get_draft_or_404(draft_id)

    if request.method == "POST":
        subject = request.form.get("subject", "").strip()
        body = request.form.get("body", "")
        db = get_db()
        db.execute(
            "UPDATE drafts SET subject = ?, body = ?, updated_at = ? WHERE id = ?",
            (subject, body, now_iso(), draft_id),
        )
        db.commit()
        flash("Draft saved.", "success")
        return redirect(url_for("edit_draft", draft_id=draft_id))

    return render_template("draft_edit.html", draft=draft)


@app.route("/drafts/<int:draft_id>/preview")
@login_required
def preview_draft(draft_id):
    draft = _get_draft_or_404(draft_id)
    sub_count = (
        get_db().execute("SELECT COUNT(*) AS n FROM subscribers").fetchone()["n"]
    )
    return render_template("preview.html", draft=draft, sub_count=sub_count)


@app.route("/drafts/<int:draft_id>/delete", methods=["POST"])
@login_required
def delete_draft(draft_id):
    _get_draft_or_404(draft_id)
    db = get_db()
    db.execute("DELETE FROM drafts WHERE id = ?", (draft_id,))
    db.commit()
    flash("Draft deleted.", "success")
    return redirect(url_for("drafts"))


# --------------------------------------------------------------------------- #
# Template filters
# --------------------------------------------------------------------------- #
@app.template_filter("nl2br")
def nl2br(value):
    """Render newlines as <br> for plain-text bodies in the preview."""
    from markupsafe import Markup, escape

    escaped = escape(value)
    return Markup(str(escaped).replace("\n", "<br>\n"))


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
with app.app_context():
    init_db()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5049, debug=True)
