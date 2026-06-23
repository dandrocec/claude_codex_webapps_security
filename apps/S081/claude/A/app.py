"""
A small Flask voting platform.

Features
--------
* Admins create elections (title, description, open/close time) with candidates.
* Registered users cast exactly one vote per election while it is open.
* Results are revealed only after an election closes.
* All data is stored in a local SQLite database.

Run with:  python app.py   (serves on http://127.0.0.1:5081)
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

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.path.join(BASE_DIR, "voting.db")
PORT = 5081

# Credentials for the bootstrap admin account, created on first run.
# Override via environment variables in real deployments.
DEFAULT_ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
DEFAULT_ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")


# --------------------------------------------------------------------------- #
# Database helpers
# --------------------------------------------------------------------------- #
def get_db():
    """Return a per-request SQLite connection."""
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(exception=None):  # noqa: ARG001
    db = g.pop("db", None)
    if db is not None:
        db.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    UNIQUE NOT NULL,
    password_hash TEXT    NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS elections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    open_time   TEXT    NOT NULL,   -- ISO-8601 UTC
    close_time  TEXT    NOT NULL,   -- ISO-8601 UTC
    created_by  INTEGER NOT NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS candidates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS votes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id  INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    created_at   TEXT    NOT NULL,
    UNIQUE (election_id, user_id)   -- enforces "one vote per election"
);
"""


def init_db():
    """Create tables (if needed) and seed the bootstrap admin account."""
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    db.executescript(SCHEMA)

    existing = db.execute(
        "SELECT id FROM users WHERE username = ?", (DEFAULT_ADMIN_USERNAME,)
    ).fetchone()
    if existing is None:
        db.execute(
            "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)",
            (DEFAULT_ADMIN_USERNAME, generate_password_hash(DEFAULT_ADMIN_PASSWORD)),
        )
        print(
            f" * Seeded admin account '{DEFAULT_ADMIN_USERNAME}' "
            f"(password '{DEFAULT_ADMIN_PASSWORD}')."
        )
    db.commit()
    db.close()


# --------------------------------------------------------------------------- #
# Time helpers
#
# Times are stored as ISO-8601 UTC strings. The browser's <input type=
# "datetime-local"> submits local wall-clock time without a timezone, so we
# treat submitted values as local and convert to/from UTC for storage.
# --------------------------------------------------------------------------- #
def now_utc():
    return datetime.now(timezone.utc)


def parse_form_datetime(value):
    """Parse a 'YYYY-MM-DDTHH:MM' value (local time) into aware UTC."""
    dt = datetime.fromisoformat(value)  # naive, local wall-clock
    return dt.astimezone().astimezone(timezone.utc)


def parse_stored(value):
    """Parse a stored ISO string back into an aware UTC datetime."""
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def election_status(election):
    """Return 'upcoming', 'open', or 'closed' for an election row."""
    now = now_utc()
    opens = parse_stored(election["open_time"])
    closes = parse_stored(election["close_time"])
    if now < opens:
        return "upcoming"
    if now >= closes:
        return "closed"
    return "open"


def humanize(value):
    """Jinja filter: stored ISO UTC -> friendly local string."""
    return parse_stored(value).astimezone().strftime("%Y-%m-%d %H:%M")


app.jinja_env.filters["humanize"] = humanize


# --------------------------------------------------------------------------- #
# Auth helpers
# --------------------------------------------------------------------------- #
def current_user():
    if "user_id" not in session:
        return None
    if "user" not in g:
        g.user = get_db().execute(
            "SELECT * FROM users WHERE id = ?", (session["user_id"],)
        ).fetchone()
    return g.user


@app.context_processor
def inject_user():
    return {"current_user": current_user()}


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if current_user() is None:
            flash("Please log in to continue.", "error")
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = current_user()
        if user is None:
            return redirect(url_for("login", next=request.path))
        if not user["is_admin"]:
            abort(403)
        return view(*args, **kwargs)

    return wrapped


# --------------------------------------------------------------------------- #
# Routes: auth
# --------------------------------------------------------------------------- #
@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        if not username or not password:
            flash("Username and password are required.", "error")
        elif len(password) < 6:
            flash("Password must be at least 6 characters.", "error")
        else:
            db = get_db()
            try:
                db.execute(
                    "INSERT INTO users (username, password_hash, is_admin) "
                    "VALUES (?, ?, 0)",
                    (username, generate_password_hash(password)),
                )
                db.commit()
            except sqlite3.IntegrityError:
                flash("That username is already taken.", "error")
            else:
                flash("Registration successful. Please log in.", "success")
                return redirect(url_for("login"))
    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
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
            flash(f"Welcome back, {user['username']}!", "success")
            nxt = request.args.get("next")
            return redirect(nxt or url_for("index"))
    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    flash("You have been logged out.", "success")
    return redirect(url_for("index"))


# --------------------------------------------------------------------------- #
# Routes: elections
# --------------------------------------------------------------------------- #
@app.route("/")
def index():
    rows = get_db().execute(
        "SELECT * FROM elections ORDER BY open_time DESC"
    ).fetchall()
    elections = [dict(r, status=election_status(r)) for r in rows]
    return render_template("index.html", elections=elections)


@app.route("/elections/<int:election_id>")
def election_detail(election_id):
    db = get_db()
    election = db.execute(
        "SELECT * FROM elections WHERE id = ?", (election_id,)
    ).fetchone()
    if election is None:
        abort(404)

    candidates = db.execute(
        "SELECT * FROM candidates WHERE election_id = ? ORDER BY id", (election_id,)
    ).fetchall()
    status = election_status(election)

    user = current_user()
    user_vote = None
    if user is not None:
        user_vote = db.execute(
            "SELECT candidate_id FROM votes WHERE election_id = ? AND user_id = ?",
            (election_id, user["id"]),
        ).fetchone()

    # Results are only computed/exposed once the election has closed.
    results = None
    total_votes = 0
    if status == "closed":
        tally = db.execute(
            "SELECT candidate_id, COUNT(*) AS n FROM votes "
            "WHERE election_id = ? GROUP BY candidate_id",
            (election_id,),
        ).fetchall()
        counts = {row["candidate_id"]: row["n"] for row in tally}
        total_votes = sum(counts.values())
        results = []
        for c in candidates:
            n = counts.get(c["id"], 0)
            pct = (n / total_votes * 100) if total_votes else 0
            results.append({"candidate": c, "votes": n, "pct": pct})
        results.sort(key=lambda r: r["votes"], reverse=True)

    return render_template(
        "election_detail.html",
        election=election,
        candidates=candidates,
        status=status,
        user_vote=user_vote["candidate_id"] if user_vote else None,
        results=results,
        total_votes=total_votes,
    )


@app.route("/elections/<int:election_id>/vote", methods=["POST"])
@login_required
def cast_vote(election_id):
    db = get_db()
    election = db.execute(
        "SELECT * FROM elections WHERE id = ?", (election_id,)
    ).fetchone()
    if election is None:
        abort(404)

    if election_status(election) != "open":
        flash("This election is not currently open for voting.", "error")
        return redirect(url_for("election_detail", election_id=election_id))

    candidate_id = request.form.get("candidate_id", type=int)
    candidate = db.execute(
        "SELECT * FROM candidates WHERE id = ? AND election_id = ?",
        (candidate_id, election_id),
    ).fetchone()
    if candidate is None:
        flash("Please choose a valid candidate.", "error")
        return redirect(url_for("election_detail", election_id=election_id))

    user = current_user()
    try:
        db.execute(
            "INSERT INTO votes (election_id, candidate_id, user_id, created_at) "
            "VALUES (?, ?, ?, ?)",
            (election_id, candidate_id, user["id"], now_utc().isoformat()),
        )
        db.commit()
    except sqlite3.IntegrityError:
        # UNIQUE(election_id, user_id) tripped: the user already voted.
        flash("You have already voted in this election.", "error")
    else:
        flash("Your vote has been recorded. Thank you!", "success")
    return redirect(url_for("election_detail", election_id=election_id))


# --------------------------------------------------------------------------- #
# Routes: admin
# --------------------------------------------------------------------------- #
@app.route("/admin/elections/new", methods=["GET", "POST"])
@admin_required
def new_election():
    if request.method == "POST":
        title = request.form.get("title", "").strip()
        description = request.form.get("description", "").strip()
        open_raw = request.form.get("open_time", "")
        close_raw = request.form.get("close_time", "")
        # One candidate per non-empty line.
        candidate_lines = [
            line.strip()
            for line in request.form.get("candidates", "").splitlines()
            if line.strip()
        ]

        errors = []
        if not title:
            errors.append("A title is required.")
        if len(candidate_lines) < 2:
            errors.append("Please provide at least two candidates (one per line).")

        opens = closes = None
        try:
            opens = parse_form_datetime(open_raw)
            closes = parse_form_datetime(close_raw)
        except (ValueError, TypeError):
            errors.append("Valid open and close times are required.")
        if opens and closes and closes <= opens:
            errors.append("The close time must be after the open time.")

        if errors:
            for e in errors:
                flash(e, "error")
            return render_template("new_election.html", form=request.form)

        db = get_db()
        cur = db.execute(
            "INSERT INTO elections (title, description, open_time, close_time, "
            "created_by) VALUES (?, ?, ?, ?, ?)",
            (
                title,
                description,
                opens.isoformat(),
                closes.isoformat(),
                current_user()["id"],
            ),
        )
        election_id = cur.lastrowid
        for name in candidate_lines:
            db.execute(
                "INSERT INTO candidates (election_id, name) VALUES (?, ?)",
                (election_id, name),
            )
        db.commit()
        flash("Election created.", "success")
        return redirect(url_for("election_detail", election_id=election_id))

    return render_template("new_election.html", form={})


# --------------------------------------------------------------------------- #
# Entrypoint
# --------------------------------------------------------------------------- #
if __name__ == "__main__":
    init_db()
    app.run(host="127.0.0.1", port=PORT, debug=True)
