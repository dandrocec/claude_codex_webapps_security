from datetime import date, datetime, timedelta
import sqlite3
from pathlib import Path

from flask import (
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


BASE_DIR = Path(__file__).resolve().parent
DATABASE = BASE_DIR / "time_tracker.sqlite3"

app = Flask(__name__)
app.config["SECRET_KEY"] = "change-this-development-secret"


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS time_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            project TEXT NOT NULL,
            entry_date TEXT NOT NULL,
            hours REAL NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_time_entries_user_date
            ON time_entries (user_id, entry_date);
        """
    )
    db.commit()


@app.before_request
def load_logged_in_user():
    init_db()
    user_id = session.get("user_id")
    if user_id is None:
        g.user = None
    else:
        g.user = get_db().execute(
            "SELECT id, username FROM users WHERE id = ?", (user_id,)
        ).fetchone()


def login_required(view):
    def wrapped_view(*args, **kwargs):
        if g.user is None:
            flash("Please log in to continue.", "error")
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    wrapped_view.__name__ = view.__name__
    return wrapped_view


def parse_week_start(value):
    if value:
        try:
            selected = datetime.strptime(value, "%Y-%m-%d").date()
        except ValueError:
            selected = date.today()
    else:
        selected = date.today()
    return selected - timedelta(days=selected.weekday())


@app.route("/")
def index():
    if g.user is None:
        return redirect(url_for("login"))
    return redirect(url_for("dashboard"))


@app.route("/register", methods=("GET", "POST"))
def register():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")

        if not username:
            flash("Username is required.", "error")
        elif not password:
            flash("Password is required.", "error")
        elif len(password) < 6:
            flash("Password must be at least 6 characters.", "error")
        else:
            try:
                db = get_db()
                db.execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username, generate_password_hash(password)),
                )
                db.commit()
            except sqlite3.IntegrityError:
                flash("That username is already taken.", "error")
            else:
                flash("Account created. Please log in.", "success")
                return redirect(url_for("login"))

    return render_template("auth.html", mode="register")


@app.route("/login", methods=("GET", "POST"))
def login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = get_db().execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()

        if user is None or not check_password_hash(user["password_hash"], password):
            flash("Invalid username or password.", "error")
        else:
            session.clear()
            session["user_id"] = user["id"]
            return redirect(url_for("dashboard"))

    return render_template("auth.html", mode="login")


@app.route("/logout", methods=("POST",))
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/dashboard", methods=("GET", "POST"))
@login_required
def dashboard():
    db = get_db()

    if request.method == "POST":
        project = request.form.get("project", "").strip()
        entry_date = request.form.get("entry_date", "").strip()
        hours_raw = request.form.get("hours", "").strip()
        note = request.form.get("note", "").strip()

        try:
            parsed_date = datetime.strptime(entry_date, "%Y-%m-%d").date()
        except ValueError:
            parsed_date = None

        try:
            hours = float(hours_raw)
        except ValueError:
            hours = 0

        if not project:
            flash("Project is required.", "error")
        elif parsed_date is None:
            flash("Use a valid entry date.", "error")
        elif hours <= 0 or hours > 24:
            flash("Hours must be greater than 0 and no more than 24.", "error")
        else:
            db.execute(
                """
                INSERT INTO time_entries (user_id, project, entry_date, hours, note)
                VALUES (?, ?, ?, ?, ?)
                """,
                (g.user["id"], project, parsed_date.isoformat(), hours, note),
            )
            db.commit()
            flash("Time entry added.", "success")
            return redirect(url_for("dashboard", week=parsed_date.isoformat()))

    week_start = parse_week_start(request.args.get("week"))
    week_end = week_start + timedelta(days=6)
    previous_week = week_start - timedelta(days=7)
    next_week = week_start + timedelta(days=7)

    entries = db.execute(
        """
        SELECT id, project, entry_date, hours, note
        FROM time_entries
        WHERE user_id = ? AND entry_date BETWEEN ? AND ?
        ORDER BY entry_date DESC, id DESC
        """,
        (g.user["id"], week_start.isoformat(), week_end.isoformat()),
    ).fetchall()

    project_totals = db.execute(
        """
        SELECT project, SUM(hours) AS total_hours
        FROM time_entries
        WHERE user_id = ? AND entry_date BETWEEN ? AND ?
        GROUP BY project
        ORDER BY project COLLATE NOCASE
        """,
        (g.user["id"], week_start.isoformat(), week_end.isoformat()),
    ).fetchall()

    daily_totals = {week_start + timedelta(days=i): 0 for i in range(7)}
    for row in db.execute(
        """
        SELECT entry_date, SUM(hours) AS total_hours
        FROM time_entries
        WHERE user_id = ? AND entry_date BETWEEN ? AND ?
        GROUP BY entry_date
        """,
        (g.user["id"], week_start.isoformat(), week_end.isoformat()),
    ).fetchall():
        daily_totals[datetime.strptime(row["entry_date"], "%Y-%m-%d").date()] = row[
            "total_hours"
        ]

    weekly_total = sum(row["hours"] for row in entries)

    return render_template(
        "dashboard.html",
        entries=entries,
        project_totals=project_totals,
        daily_totals=daily_totals,
        weekly_total=weekly_total,
        week_start=week_start,
        week_end=week_end,
        previous_week=previous_week,
        next_week=next_week,
        today=date.today().isoformat(),
    )


@app.route("/entries/<int:entry_id>/delete", methods=("POST",))
@login_required
def delete_entry(entry_id):
    db = get_db()
    entry = db.execute(
        "SELECT entry_date FROM time_entries WHERE id = ? AND user_id = ?",
        (entry_id, g.user["id"]),
    ).fetchone()
    if entry is not None:
        db.execute(
            "DELETE FROM time_entries WHERE id = ? AND user_id = ?",
            (entry_id, g.user["id"]),
        )
        db.commit()
        flash("Time entry deleted.", "success")
        return redirect(url_for("dashboard", week=entry["entry_date"]))
    flash("Entry not found.", "error")
    return redirect(url_for("dashboard"))


if __name__ == "__main__":
    with app.app_context():
        init_db()
    app.run(host="127.0.0.1", port=5054, debug=True)
