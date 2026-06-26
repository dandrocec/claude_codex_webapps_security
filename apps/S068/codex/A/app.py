import os
import sqlite3
from datetime import datetime
from functools import wraps

from flask import Flask, flash, g, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash


BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.path.join(BASE_DIR, "scheduler.sqlite3")

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('provider', 'client'))
        );

        CREATE TABLE IF NOT EXISTS slots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider_id INTEGER NOT NULL,
            starts_at TEXT NOT NULL,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (provider_id, starts_at),
            FOREIGN KEY (provider_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slot_id INTEGER NOT NULL UNIQUE,
            client_id INTEGER NOT NULL,
            confirmation_code TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (slot_id) REFERENCES slots(id) ON DELETE CASCADE,
            FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE
        );
        """
    )
    db.commit()


@app.before_request
def load_user():
    init_db()
    user_id = session.get("user_id")
    g.user = None
    if user_id:
        g.user = get_db().execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def login_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        if g.user is None:
            flash("Please sign in first.", "warning")
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped_view


def role_required(role):
    def decorator(view):
        @wraps(view)
        def wrapped_view(*args, **kwargs):
            if g.user is None:
                flash("Please sign in first.", "warning")
                return redirect(url_for("login"))
            if g.user["role"] != role:
                flash("That page is not available for your account type.", "danger")
                return redirect(url_for("dashboard"))
            return view(*args, **kwargs)

        return wrapped_view

    return decorator


def parse_datetime(value):
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M")
    except ValueError:
        return None
    return parsed.strftime("%Y-%m-%d %H:%M")


def confirmation_code(slot_id, client_id):
    stamp = datetime.utcnow().strftime("%Y%m%d%H%M%S%f")
    return f"CONF-{slot_id}-{client_id}-{stamp}"


@app.route("/")
def index():
    if g.user:
        return redirect(url_for("dashboard"))
    return render_template("index.html")


@app.route("/register", methods=("GET", "POST"))
def register():
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        role = request.form.get("role", "")

        if not name or not email or not password:
            flash("Name, email, and password are required.", "danger")
        elif role not in {"provider", "client"}:
            flash("Choose either provider or client.", "danger")
        else:
            try:
                get_db().execute(
                    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
                    (name, email, generate_password_hash(password), role),
                )
                get_db().commit()
                flash("Account created. Please sign in.", "success")
                return redirect(url_for("login"))
            except sqlite3.IntegrityError:
                flash("An account with that email already exists.", "danger")

    return render_template("register.html")


@app.route("/login", methods=("GET", "POST"))
def login():
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        user = get_db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

        if user is None or not check_password_hash(user["password_hash"], password):
            flash("Invalid email or password.", "danger")
        else:
            session.clear()
            session["user_id"] = user["id"]
            return redirect(url_for("dashboard"))

    return render_template("login.html")


@app.route("/logout", methods=("POST",))
def logout():
    session.clear()
    flash("Signed out.", "info")
    return redirect(url_for("index"))


@app.route("/dashboard")
@login_required
def dashboard():
    if g.user["role"] == "provider":
        return redirect(url_for("provider_dashboard"))
    return redirect(url_for("client_dashboard"))


@app.route("/provider", methods=("GET", "POST"))
@role_required("provider")
def provider_dashboard():
    if request.method == "POST":
        starts_at = parse_datetime(request.form.get("starts_at", ""))
        notes = request.form.get("notes", "").strip()
        if starts_at is None:
            flash("Choose a valid date and time.", "danger")
        else:
            try:
                get_db().execute(
                    "INSERT INTO slots (provider_id, starts_at, notes) VALUES (?, ?, ?)",
                    (g.user["id"], starts_at, notes),
                )
                get_db().commit()
                flash("Slot published.", "success")
            except sqlite3.IntegrityError:
                flash("You already published a slot at that time.", "danger")

        return redirect(url_for("provider_dashboard"))

    appointments = get_db().execute(
        """
        SELECT
            slots.id,
            slots.starts_at,
            slots.notes,
            bookings.confirmation_code,
            clients.name AS client_name,
            clients.email AS client_email
        FROM slots
        LEFT JOIN bookings ON bookings.slot_id = slots.id
        LEFT JOIN users AS clients ON clients.id = bookings.client_id
        WHERE slots.provider_id = ?
        ORDER BY slots.starts_at
        """,
        (g.user["id"],),
    ).fetchall()
    return render_template("provider.html", appointments=appointments)


@app.route("/client")
@role_required("client")
def client_dashboard():
    available_slots = get_db().execute(
        """
        SELECT slots.id, slots.starts_at, slots.notes, providers.name AS provider_name
        FROM slots
        JOIN users AS providers ON providers.id = slots.provider_id
        LEFT JOIN bookings ON bookings.slot_id = slots.id
        WHERE bookings.id IS NULL
        ORDER BY slots.starts_at
        """
    ).fetchall()
    appointments = get_db().execute(
        """
        SELECT
            slots.starts_at,
            slots.notes,
            providers.name AS provider_name,
            providers.email AS provider_email,
            bookings.confirmation_code
        FROM bookings
        JOIN slots ON slots.id = bookings.slot_id
        JOIN users AS providers ON providers.id = slots.provider_id
        WHERE bookings.client_id = ?
        ORDER BY slots.starts_at
        """,
        (g.user["id"],),
    ).fetchall()
    return render_template("client.html", available_slots=available_slots, appointments=appointments)


@app.route("/book/<int:slot_id>", methods=("POST",))
@role_required("client")
def book(slot_id):
    db = get_db()
    slot = db.execute(
        """
        SELECT slots.id, slots.starts_at, providers.name AS provider_name
        FROM slots
        JOIN users AS providers ON providers.id = slots.provider_id
        WHERE slots.id = ?
        """,
        (slot_id,),
    ).fetchone()
    if slot is None:
        flash("That slot no longer exists.", "danger")
        return redirect(url_for("client_dashboard"))

    try:
        code = confirmation_code(slot_id, g.user["id"])
        db.execute(
            "INSERT INTO bookings (slot_id, client_id, confirmation_code) VALUES (?, ?, ?)",
            (slot_id, g.user["id"], code),
        )
        db.commit()
        flash(f"Booked with {slot['provider_name']} for {slot['starts_at']}. Confirmation: {code}", "success")
    except sqlite3.IntegrityError:
        flash("That slot has already been booked.", "danger")

    return redirect(url_for("client_dashboard"))


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5068, debug=True)
