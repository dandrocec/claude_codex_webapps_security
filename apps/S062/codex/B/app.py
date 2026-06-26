import os
import re
import secrets
import sqlite3
from datetime import datetime, timezone
from functools import wraps

import bleach
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
from flask_bcrypt import Bcrypt


DATABASE = "helpdesk.sqlite3"
STATUSES = ("open", "pending", "resolved", "closed")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

bcrypt = Bcrypt()


def create_app():
    app = Flask(__name__)
    secret_key = os.environ.get("SECRET_KEY")
    if not secret_key:
        raise RuntimeError("SECRET_KEY environment variable is required")

    app.config.update(
        SECRET_KEY=secret_key,
        DATABASE=os.environ.get("DATABASE_URL", DATABASE),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=True,
        SESSION_COOKIE_SAMESITE="Lax",
        MAX_CONTENT_LENGTH=1024 * 1024,
    )
    bcrypt.init_app(app)

    @app.before_request
    def load_user_and_check_csrf():
        g.user = current_user()
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            submitted = request.form.get("csrf_token", "")
            expected = session.get("csrf_token", "")
            if not submitted or not expected or not secrets.compare_digest(submitted, expected):
                abort(400)

    @app.after_request
    def set_security_headers(response):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "frame-ancestors 'none'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    @app.context_processor
    def inject_helpers():
        return {"csrf_token": get_csrf_token, "statuses": STATUSES}

    @app.teardown_appcontext
    def close_db(error=None):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    @app.cli.command("init-db")
    def init_db_command():
        init_db()
        print("Initialized the database.")

    @app.cli.command("create-agent")
    def create_agent_command():
        email = os.environ.get("AGENT_EMAIL")
        password = os.environ.get("AGENT_PASSWORD")
        name = os.environ.get("AGENT_NAME", "Support Agent")
        if not email or not password:
            raise RuntimeError("AGENT_EMAIL and AGENT_PASSWORD are required")
        create_user(email=email, password=password, name=name, role="agent")
        print(f"Created agent account: {email}")

    @app.get("/")
    def index():
        if g.user:
            return redirect(url_for("tickets"))
        return redirect(url_for("login"))

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            name = clean_text(request.form.get("name"), 80)
            email = clean_email(request.form.get("email"))
            password = request.form.get("password", "")
            if not name or not email or len(password) < 12:
                flash("Enter a valid name, email, and a password of at least 12 characters.", "error")
                return render_template("register.html"), 400
            try:
                create_user(email=email, password=password, name=name, role="customer")
            except sqlite3.IntegrityError:
                flash("That email is already registered.", "error")
                return render_template("register.html"), 409
            flash("Account created. Please sign in.", "success")
            return redirect(url_for("login"))
        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            email = clean_email(request.form.get("email"))
            password = request.form.get("password", "")
            user = query_one("SELECT * FROM users WHERE email = ?", (email,))
            if not user or not bcrypt.check_password_hash(user["password_hash"], password):
                flash("Invalid email or password.", "error")
                return render_template("login.html"), 401
            session.clear()
            session["user_id"] = user["id"]
            session["csrf_token"] = secrets.token_urlsafe(32)
            return redirect(url_for("tickets"))
        return render_template("login.html")

    @app.post("/logout")
    @login_required
    def logout():
        session.clear()
        return redirect(url_for("login"))

    @app.route("/tickets", methods=["GET", "POST"])
    @login_required
    def tickets():
        if request.method == "POST":
            title = clean_text(request.form.get("title"), 120)
            body = clean_text(request.form.get("body"), 4000)
            if not title or not body:
                flash("A title and message are required.", "error")
                return render_template("new_ticket.html"), 400
            execute(
                "INSERT INTO tickets (customer_id, title, body, status, created_at, updated_at) "
                "VALUES (?, ?, ?, 'open', ?, ?)",
                (g.user["id"], title, body, utcnow(), utcnow()),
            )
            ticket_id = query_one("SELECT last_insert_rowid() AS id")["id"]
            flash("Ticket opened.", "success")
            return redirect(url_for("ticket_detail", ticket_id=ticket_id))

        if is_agent():
            rows = query_all(
                """
                SELECT tickets.*, customers.name AS customer_name, agents.name AS agent_name
                FROM tickets
                JOIN users AS customers ON customers.id = tickets.customer_id
                LEFT JOIN users AS agents ON agents.id = tickets.agent_id
                ORDER BY tickets.updated_at DESC
                """
            )
        else:
            rows = query_all(
                """
                SELECT tickets.*, NULL AS customer_name, agents.name AS agent_name
                FROM tickets
                LEFT JOIN users AS agents ON agents.id = tickets.agent_id
                WHERE tickets.customer_id = ?
                ORDER BY tickets.updated_at DESC
                """,
                (g.user["id"],),
            )
        return render_template("tickets.html", tickets=rows)

    @app.get("/tickets/new")
    @login_required
    def new_ticket():
        return render_template("new_ticket.html")

    @app.route("/tickets/<int:ticket_id>", methods=["GET", "POST"])
    @login_required
    def ticket_detail(ticket_id):
        ticket = get_authorized_ticket(ticket_id)
        if request.method == "POST":
            message = clean_text(request.form.get("message"), 4000)
            if not message:
                flash("Reply message is required.", "error")
                return redirect(url_for("ticket_detail", ticket_id=ticket_id))
            execute(
                "INSERT INTO replies (ticket_id, user_id, body, created_at) VALUES (?, ?, ?, ?)",
                (ticket_id, g.user["id"], message, utcnow()),
            )
            execute("UPDATE tickets SET updated_at = ? WHERE id = ?", (utcnow(), ticket_id))
            flash("Reply added.", "success")
            return redirect(url_for("ticket_detail", ticket_id=ticket_id))
        replies = query_all(
            """
            SELECT replies.*, users.name, users.role
            FROM replies
            JOIN users ON users.id = replies.user_id
            WHERE replies.ticket_id = ?
            ORDER BY replies.created_at ASC
            """,
            (ticket_id,),
        )
        agents = query_all("SELECT id, name, email FROM users WHERE role = 'agent' ORDER BY name")
        return render_template("ticket_detail.html", ticket=ticket, replies=replies, agents=agents)

    @app.post("/tickets/<int:ticket_id>/assign")
    @login_required
    @agent_required
    def assign_ticket(ticket_id):
        get_authorized_ticket(ticket_id)
        agent_id_raw = request.form.get("agent_id", "")
        if agent_id_raw == "":
            agent_id = None
        elif agent_id_raw.isdigit():
            agent = query_one("SELECT id FROM users WHERE id = ? AND role = 'agent'", (int(agent_id_raw),))
            if not agent:
                abort(400)
            agent_id = agent["id"]
        else:
            abort(400)
        execute(
            "UPDATE tickets SET agent_id = ?, updated_at = ? WHERE id = ?",
            (agent_id, utcnow(), ticket_id),
        )
        flash("Assignment updated.", "success")
        return redirect(url_for("ticket_detail", ticket_id=ticket_id))

    @app.post("/tickets/<int:ticket_id>/status")
    @login_required
    @agent_required
    def change_status(ticket_id):
        get_authorized_ticket(ticket_id)
        status = request.form.get("status", "")
        if status not in STATUSES:
            abort(400)
        execute("UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?", (status, utcnow(), ticket_id))
        flash("Status updated.", "success")
        return redirect(url_for("ticket_detail", ticket_id=ticket_id))

    @app.errorhandler(400)
    def bad_request(error):
        return render_template("error.html", message="Bad request."), 400

    @app.errorhandler(403)
    def forbidden(error):
        return render_template("error.html", message="You do not have access to that resource."), 403

    @app.errorhandler(404)
    def not_found(error):
        return render_template("error.html", message="Not found."), 404

    @app.errorhandler(500)
    def server_error(error):
        return render_template("error.html", message="An internal error occurred."), 500

    return app


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(current_app_config("DATABASE"))
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def current_app_config(key):
    from flask import current_app

    return current_app.config[key]


def init_db():
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('customer', 'agent')),
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            agent_id INTEGER,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('open', 'pending', 'resolved', 'closed')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (agent_id) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS replies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_tickets_customer ON tickets(customer_id);
        CREATE INDEX IF NOT EXISTS idx_tickets_agent ON tickets(agent_id);
        CREATE INDEX IF NOT EXISTS idx_replies_ticket ON replies(ticket_id);
        """
    )
    db.commit()


def create_user(email, password, name, role):
    password_hash = bcrypt.generate_password_hash(password).decode("utf-8")
    execute(
        "INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
        (email, name, password_hash, role, utcnow()),
    )


def execute(sql, params=()):
    db = get_db()
    cursor = db.execute(sql, params)
    db.commit()
    return cursor


def query_one(sql, params=()):
    return get_db().execute(sql, params).fetchone()


def query_all(sql, params=()):
    return get_db().execute(sql, params).fetchall()


def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    return query_one("SELECT id, email, name, role FROM users WHERE id = ?", (user_id,))


def get_csrf_token():
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_urlsafe(32)
    return session["csrf_token"]


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not g.user:
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped


def agent_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not is_agent():
            abort(403)
        return view(*args, **kwargs)

    return wrapped


def is_agent():
    return bool(g.user and g.user["role"] == "agent")


def get_authorized_ticket(ticket_id):
    ticket = query_one(
        """
        SELECT tickets.*, customers.name AS customer_name, agents.name AS agent_name
        FROM tickets
        JOIN users AS customers ON customers.id = tickets.customer_id
        LEFT JOIN users AS agents ON agents.id = tickets.agent_id
        WHERE tickets.id = ?
        """,
        (ticket_id,),
    )
    if not ticket:
        abort(404)
    if not is_agent() and ticket["customer_id"] != g.user["id"]:
        abort(403)
    return ticket


def clean_email(value):
    email = clean_text(value, 254).lower()
    return email if EMAIL_RE.match(email) else ""


def clean_text(value, max_length):
    if value is None:
        return ""
    cleaned = bleach.clean(value.strip(), tags=[], attributes={}, protocols=[], strip=True)
    cleaned = re.sub(r"\r\n?", "\n", cleaned)
    return cleaned[:max_length]


def utcnow():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5062)
