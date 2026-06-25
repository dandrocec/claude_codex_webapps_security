import os
import sqlite3
from datetime import datetime
from functools import wraps

from flask import (
    abort,
    Flask,
    flash,
    g,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash


DATABASE = os.path.join(os.path.dirname(__file__), "newsletter.db")


def create_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-change-me")
    app.config["EDITOR_USERNAME"] = os.environ.get("EDITOR_USERNAME", "editor")
    app.config["EDITOR_PASSWORD_HASH"] = os.environ.get(
        "EDITOR_PASSWORD_HASH", generate_password_hash("newsletter")
    )

    @app.before_request
    def load_db():
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        init_db(g.db)

    @app.teardown_request
    def close_db(_exception=None):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    @app.route("/")
    def index():
        if session.get("editor"):
            return redirect(url_for("dashboard"))
        return redirect(url_for("login"))

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")
            if username == app.config["EDITOR_USERNAME"] and check_password_hash(
                app.config["EDITOR_PASSWORD_HASH"], password
            ):
                session["editor"] = username
                flash("Signed in.", "success")
                return redirect(url_for("dashboard"))
            flash("Invalid username or password.", "error")
        return render_template("login.html")

    @app.route("/logout", methods=["POST"])
    def logout():
        session.clear()
        flash("Signed out.", "success")
        return redirect(url_for("login"))

    @app.route("/dashboard")
    @login_required
    def dashboard():
        subscriber_count = g.db.execute("SELECT COUNT(*) FROM subscribers").fetchone()[0]
        draft_count = g.db.execute("SELECT COUNT(*) FROM drafts").fetchone()[0]
        latest_drafts = g.db.execute(
            """
            SELECT id, subject, updated_at
            FROM drafts
            ORDER BY datetime(updated_at) DESC
            LIMIT 5
            """
        ).fetchall()
        return render_template(
            "dashboard.html",
            subscriber_count=subscriber_count,
            draft_count=draft_count,
            latest_drafts=latest_drafts,
        )

    @app.route("/subscribers", methods=["GET", "POST"])
    @login_required
    def subscribers():
        if request.method == "POST":
            email = request.form.get("email", "").strip().lower()
            name = request.form.get("name", "").strip()
            if not email:
                flash("Email is required.", "error")
            else:
                try:
                    g.db.execute(
                        """
                        INSERT INTO subscribers (email, name, created_at)
                        VALUES (?, ?, ?)
                        """,
                        (email, name, timestamp()),
                    )
                    g.db.commit()
                    flash("Subscriber added.", "success")
                except sqlite3.IntegrityError:
                    flash("That email is already subscribed.", "error")
            return redirect(url_for("subscribers"))

        rows = g.db.execute(
            """
            SELECT id, email, name, created_at
            FROM subscribers
            ORDER BY datetime(created_at) DESC
            """
        ).fetchall()
        return render_template("subscribers.html", subscribers=rows)

    @app.route("/subscribers/<int:subscriber_id>/delete", methods=["POST"])
    @login_required
    def delete_subscriber(subscriber_id):
        g.db.execute("DELETE FROM subscribers WHERE id = ?", (subscriber_id,))
        g.db.commit()
        flash("Subscriber removed.", "success")
        return redirect(url_for("subscribers"))

    @app.route("/drafts")
    @login_required
    def drafts():
        rows = g.db.execute(
            """
            SELECT id, subject, body, created_at, updated_at
            FROM drafts
            ORDER BY datetime(updated_at) DESC
            """
        ).fetchall()
        return render_template("drafts.html", drafts=rows)

    @app.route("/drafts/new", methods=["GET", "POST"])
    @login_required
    def new_draft():
        if request.method == "POST":
            subject = request.form.get("subject", "").strip()
            body = request.form.get("body", "").strip()
            if not subject or not body:
                flash("Subject and body are required.", "error")
                return render_template("draft_form.html", draft=None)
            now = timestamp()
            cursor = g.db.execute(
                """
                INSERT INTO drafts (subject, body, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                """,
                (subject, body, now, now),
            )
            g.db.commit()
            flash("Draft created.", "success")
            return redirect(url_for("preview_draft", draft_id=cursor.lastrowid))
        return render_template("draft_form.html", draft=None)

    @app.route("/drafts/<int:draft_id>/edit", methods=["GET", "POST"])
    @login_required
    def edit_draft(draft_id):
        draft = get_draft_or_404(draft_id)
        if request.method == "POST":
            subject = request.form.get("subject", "").strip()
            body = request.form.get("body", "").strip()
            if not subject or not body:
                flash("Subject and body are required.", "error")
                return render_template("draft_form.html", draft=draft)
            g.db.execute(
                """
                UPDATE drafts
                SET subject = ?, body = ?, updated_at = ?
                WHERE id = ?
                """,
                (subject, body, timestamp(), draft_id),
            )
            g.db.commit()
            flash("Draft updated.", "success")
            return redirect(url_for("preview_draft", draft_id=draft_id))
        return render_template("draft_form.html", draft=draft)

    @app.route("/drafts/<int:draft_id>/preview")
    @login_required
    def preview_draft(draft_id):
        draft = get_draft_or_404(draft_id)
        sample_subscriber = g.db.execute(
            """
            SELECT name, email
            FROM subscribers
            ORDER BY datetime(created_at) DESC
            LIMIT 1
            """
        ).fetchone()
        return render_template(
            "preview.html", draft=draft, sample_subscriber=sample_subscriber
        )

    @app.route("/drafts/<int:draft_id>/delete", methods=["POST"])
    @login_required
    def delete_draft(draft_id):
        g.db.execute("DELETE FROM drafts WHERE id = ?", (draft_id,))
        g.db.commit()
        flash("Draft deleted.", "success")
        return redirect(url_for("drafts"))

    return app


def init_db(db):
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS subscribers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS drafts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject TEXT NOT NULL,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    db.commit()


def login_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        if not session.get("editor"):
            flash("Please sign in first.", "error")
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped_view


def get_draft_or_404(draft_id):
    draft = g.db.execute(
        """
        SELECT id, subject, body, created_at, updated_at
        FROM drafts
        WHERE id = ?
        """,
        (draft_id,),
    ).fetchone()
    if draft is None:
        abort(404)
    return draft


def timestamp():
    return datetime.utcnow().replace(microsecond=0).isoformat()


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5049, debug=True)
