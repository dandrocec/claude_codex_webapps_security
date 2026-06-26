from datetime import datetime
import os
import sqlite3
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
DATABASE = os.path.join(BASE_DIR, "voting.db")
DATETIME_FORMAT = "%Y-%m-%dT%H:%M"

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-only-change-me")


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_error):
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
            is_admin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS elections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            opens_at TEXT NOT NULL,
            closes_at TEXT NOT NULL,
            created_by INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by) REFERENCES users (id)
        );

        CREATE TABLE IF NOT EXISTS candidates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            election_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            statement TEXT,
            FOREIGN KEY (election_id) REFERENCES elections (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            election_id INTEGER NOT NULL,
            candidate_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            cast_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (election_id, user_id),
            FOREIGN KEY (election_id) REFERENCES elections (id) ON DELETE CASCADE,
            FOREIGN KEY (candidate_id) REFERENCES candidates (id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );
        """
    )
    admin = db.execute("SELECT id FROM users WHERE username = ?", ("admin",)).fetchone()
    if admin is None:
        db.execute(
            "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)",
            ("admin", generate_password_hash("admin123")),
        )
    db.commit()


@app.before_request
def load_current_user():
    user_id = session.get("user_id")
    g.user = None
    if user_id:
        g.user = get_db().execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def login_required(view):
    @wraps(view)
    def wrapped_view(**kwargs):
        if g.user is None:
            flash("Please log in to continue.", "warning")
            return redirect(url_for("login", next=request.path))
        return view(**kwargs)

    return wrapped_view


def admin_required(view):
    @wraps(view)
    @login_required
    def wrapped_view(**kwargs):
        if not g.user["is_admin"]:
            abort(403)
        return view(**kwargs)

    return wrapped_view


def parse_datetime(value):
    try:
        return datetime.strptime(value, DATETIME_FORMAT)
    except (TypeError, ValueError):
        return None


def row_datetime(row, column):
    return datetime.strptime(row[column], DATETIME_FORMAT)


def election_status(election):
    now = datetime.now()
    opens_at = row_datetime(election, "opens_at")
    closes_at = row_datetime(election, "closes_at")
    if now < opens_at:
        return "upcoming"
    if now >= closes_at:
        return "closed"
    return "open"


@app.context_processor
def inject_helpers():
    return {"election_status": election_status, "now": datetime.now}


@app.route("/")
def index():
    db = get_db()
    elections = db.execute(
        """
        SELECT e.*,
               COUNT(DISTINCT c.id) AS candidate_count,
               COUNT(DISTINCT v.id) AS vote_count
        FROM elections e
        LEFT JOIN candidates c ON c.election_id = e.id
        LEFT JOIN votes v ON v.election_id = e.id
        GROUP BY e.id
        ORDER BY e.opens_at DESC
        """
    ).fetchall()
    return render_template("index.html", elections=elections)


@app.route("/register", methods=("GET", "POST"))
def register():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        error = None
        if not username:
            error = "Username is required."
        elif len(password) < 6:
            error = "Password must be at least 6 characters."

        if error is None:
            try:
                db = get_db()
                db.execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username, generate_password_hash(password)),
                )
                db.commit()
            except sqlite3.IntegrityError:
                error = "That username is already registered."
            else:
                flash("Registration complete. You can log in now.", "success")
                return redirect(url_for("login"))

        flash(error, "danger")
    return render_template("register.html")


@app.route("/login", methods=("GET", "POST"))
def login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = get_db().execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        if user is None or not check_password_hash(user["password_hash"], password):
            flash("Invalid username or password.", "danger")
        else:
            session.clear()
            session["user_id"] = user["id"]
            flash("Logged in successfully.", "success")
            return redirect(request.args.get("next") or url_for("index"))
    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    flash("Logged out.", "info")
    return redirect(url_for("index"))


@app.route("/elections/<int:election_id>")
def election_detail(election_id):
    db = get_db()
    election = db.execute("SELECT * FROM elections WHERE id = ?", (election_id,)).fetchone()
    if election is None:
        abort(404)
    candidates = db.execute(
        "SELECT * FROM candidates WHERE election_id = ? ORDER BY name", (election_id,)
    ).fetchall()
    user_vote = None
    if g.user:
        user_vote = db.execute(
            "SELECT * FROM votes WHERE election_id = ? AND user_id = ?",
            (election_id, g.user["id"]),
        ).fetchone()
    results = None
    total_votes = 0
    if election_status(election) == "closed":
        results = db.execute(
            """
            SELECT c.id, c.name, COUNT(v.id) AS votes
            FROM candidates c
            LEFT JOIN votes v ON v.candidate_id = c.id
            WHERE c.election_id = ?
            GROUP BY c.id
            ORDER BY votes DESC, c.name ASC
            """,
            (election_id,),
        ).fetchall()
        total_votes = sum(row["votes"] for row in results)
    return render_template(
        "election_detail.html",
        election=election,
        candidates=candidates,
        user_vote=user_vote,
        results=results,
        total_votes=total_votes,
    )


@app.route("/elections/<int:election_id>/vote", methods=("POST",))
@login_required
def vote(election_id):
    db = get_db()
    election = db.execute("SELECT * FROM elections WHERE id = ?", (election_id,)).fetchone()
    if election is None:
        abort(404)
    if election_status(election) != "open":
        flash("Voting is only available while the election is open.", "warning")
        return redirect(url_for("election_detail", election_id=election_id))

    candidate_id = request.form.get("candidate_id", type=int)
    candidate = db.execute(
        "SELECT * FROM candidates WHERE id = ? AND election_id = ?",
        (candidate_id, election_id),
    ).fetchone()
    if candidate is None:
        flash("Choose a valid candidate.", "danger")
        return redirect(url_for("election_detail", election_id=election_id))

    try:
        db.execute(
            "INSERT INTO votes (election_id, candidate_id, user_id) VALUES (?, ?, ?)",
            (election_id, candidate_id, g.user["id"]),
        )
        db.commit()
        flash("Your vote has been recorded.", "success")
    except sqlite3.IntegrityError:
        flash("You have already voted in this election.", "warning")
    return redirect(url_for("election_detail", election_id=election_id))


@app.route("/admin")
@admin_required
def admin_dashboard():
    elections = get_db().execute(
        """
        SELECT e.*, COUNT(DISTINCT c.id) AS candidate_count, COUNT(DISTINCT v.id) AS vote_count
        FROM elections e
        LEFT JOIN candidates c ON c.election_id = e.id
        LEFT JOIN votes v ON v.election_id = e.id
        GROUP BY e.id
        ORDER BY e.created_at DESC
        """
    ).fetchall()
    return render_template("admin_dashboard.html", elections=elections)


@app.route("/admin/elections/new", methods=("GET", "POST"))
@admin_required
def create_election():
    if request.method == "POST":
        title = request.form.get("title", "").strip()
        description = request.form.get("description", "").strip()
        opens_at_raw = request.form.get("opens_at", "")
        closes_at_raw = request.form.get("closes_at", "")
        candidate_lines = request.form.get("candidates", "").splitlines()
        candidates = [line.strip() for line in candidate_lines if line.strip()]
        opens_at = parse_datetime(opens_at_raw)
        closes_at = parse_datetime(closes_at_raw)

        errors = []
        if not title:
            errors.append("Title is required.")
        if opens_at is None or closes_at is None:
            errors.append("Open and close times must be valid.")
        elif closes_at <= opens_at:
            errors.append("Close time must be after open time.")
        if len(candidates) < 2:
            errors.append("Add at least two candidates.")

        if errors:
            for error in errors:
                flash(error, "danger")
        else:
            db = get_db()
            cursor = db.execute(
                """
                INSERT INTO elections (title, description, opens_at, closes_at, created_by)
                VALUES (?, ?, ?, ?, ?)
                """,
                (title, description, opens_at_raw, closes_at_raw, g.user["id"]),
            )
            election_id = cursor.lastrowid
            db.executemany(
                "INSERT INTO candidates (election_id, name) VALUES (?, ?)",
                [(election_id, name) for name in candidates],
            )
            db.commit()
            flash("Election created.", "success")
            return redirect(url_for("admin_dashboard"))

    return render_template("create_election.html")


@app.route("/admin/elections/<int:election_id>/delete", methods=("POST",))
@admin_required
def delete_election(election_id):
    db = get_db()
    db.execute("DELETE FROM elections WHERE id = ?", (election_id,))
    db.commit()
    flash("Election deleted.", "info")
    return redirect(url_for("admin_dashboard"))


@app.errorhandler(403)
def forbidden(_error):
    return render_template("error.html", code=403, message="You do not have access to this page."), 403


@app.errorhandler(404)
def not_found(_error):
    return render_template("error.html", code=404, message="Page not found."), 404


with app.app_context():
    init_db()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5081, debug=True)
