import os
import re
import secrets
import sqlite3
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from functools import wraps

import bcrypt
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


DATABASE = os.environ.get("DATABASE_PATH", "invoice_app.sqlite3")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def create_app():
    app = Flask(__name__)
    secret_key = os.environ.get("FLASK_SECRET_KEY")
    if not secret_key:
        raise RuntimeError("FLASK_SECRET_KEY environment variable is required")

    app.config.update(
        SECRET_KEY=secret_key,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "true").lower()
        == "true",
        SESSION_COOKIE_SAMESITE="Lax",
        MAX_CONTENT_LENGTH=256 * 1024,
    )

    register_hooks(app)
    register_routes(app)
    return app


def db():
    if "db" not in g:
        conn = sqlite3.connect(DATABASE)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        g.db = conn
    return g.db


def register_hooks(app):
    @app.before_request
    def before_request():
        init_db()
        g.user = current_user()
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            require_csrf()

    @app.after_request
    def set_security_headers(response):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; object-src 'none'; base-uri 'self'; "
            "frame-ancestors 'none'; form-action 'self'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.teardown_appcontext
    def close_db(_error):
        conn = g.pop("db", None)
        if conn is not None:
            conn.close()

    @app.errorhandler(400)
    def bad_request(_error):
        return render_template("error.html", title="Bad request", message="The request could not be processed."), 400

    @app.errorhandler(403)
    def forbidden(_error):
        return render_template("error.html", title="Forbidden", message="You do not have access to this resource."), 403

    @app.errorhandler(404)
    def not_found(_error):
        return render_template("error.html", title="Not found", message="The requested page was not found."), 404

    @app.errorhandler(413)
    def too_large(_error):
        return render_template("error.html", title="Too large", message="The submitted data is too large."), 413

    @app.errorhandler(500)
    def server_error(_error):
        return render_template("error.html", title="Server error", message="An unexpected error occurred."), 500


def init_db():
    conn = db()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            password_hash BLOB NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS clients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            email TEXT,
            address TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            client_id INTEGER NOT NULL,
            invoice_number TEXT NOT NULL,
            issue_date TEXT NOT NULL,
            due_date TEXT,
            tax_rate TEXT NOT NULL DEFAULT '0.00',
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
            UNIQUE (user_id, invoice_number)
        );

        CREATE TABLE IF NOT EXISTS line_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_id INTEGER NOT NULL,
            description TEXT NOT NULL,
            quantity TEXT NOT NULL,
            unit_price TEXT NOT NULL,
            FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
        );
        """
    )
    conn.commit()


def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    return db().execute("SELECT id, email FROM users WHERE id = ?", (user_id,)).fetchone()


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not g.user:
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped


def csrf_token():
    token = session.get("csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["csrf_token"] = token
    return token


def require_csrf():
    form_token = request.form.get("csrf_token", "")
    session_token = session.get("csrf_token", "")
    if not form_token or not session_token or not secrets.compare_digest(form_token, session_token):
        abort(400)


def clean_text(value, field, max_len, required=False):
    value = (value or "").strip()
    if required and not value:
        raise ValueError(f"{field} is required")
    if len(value) > max_len:
        raise ValueError(f"{field} is too long")
    return value


def clean_email(value, required=False):
    value = clean_text(value, "Email", 254, required).lower()
    if value and not EMAIL_RE.match(value):
        raise ValueError("Enter a valid email address")
    return value


def money(value, field, minimum=Decimal("0.00"), maximum=Decimal("999999.99")):
    raw = (value or "").strip()
    try:
        amount = Decimal(raw)
    except (InvalidOperation, ValueError):
        raise ValueError(f"{field} must be a valid number")
    if amount < minimum or amount > maximum:
        raise ValueError(f"{field} is out of range")
    return amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def percent(value):
    return money(value, "Tax rate", Decimal("0.00"), Decimal("100.00"))


def date_value(value, field, required=False):
    value = clean_text(value, field, 10, required)
    if value:
        try:
            datetime.strptime(value, "%Y-%m-%d")
        except ValueError:
            raise ValueError(f"{field} must be a valid date")
    return value


def int_id(value):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        abort(404)
    if parsed < 1:
        abort(404)
    return parsed


def invoice_totals(items, tax_rate):
    subtotal = sum(Decimal(item["quantity"]) * Decimal(item["unit_price"]) for item in items)
    subtotal = subtotal.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    tax = (subtotal * Decimal(tax_rate) / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return {"subtotal": subtotal, "tax": tax, "total": subtotal + tax}


def get_client_owned(client_id):
    client = db().execute(
        "SELECT * FROM clients WHERE id = ? AND user_id = ?", (client_id, g.user["id"])
    ).fetchone()
    if not client:
        abort(404)
    return client


def get_invoice_owned(invoice_id):
    invoice = db().execute(
        """
        SELECT invoices.*, clients.name AS client_name, clients.email AS client_email,
               clients.address AS client_address
        FROM invoices
        JOIN clients ON clients.id = invoices.client_id
        WHERE invoices.id = ? AND invoices.user_id = ?
        """,
        (invoice_id, g.user["id"]),
    ).fetchone()
    if not invoice:
        abort(404)
    return invoice


def register_routes(app):
    @app.route("/")
    def index():
        if g.user:
            return redirect(url_for("invoices"))
        return redirect(url_for("login"))

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            try:
                email = clean_email(request.form.get("email"), required=True)
                password = request.form.get("password", "")
                if len(password) < 12 or len(password) > 128:
                    raise ValueError("Password must be 12 to 128 characters")
                password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12))
                db().execute(
                    "INSERT INTO users (email, password_hash) VALUES (?, ?)",
                    (email, password_hash),
                )
                db().commit()
                flash("Account created. Please sign in.", "success")
                return redirect(url_for("login"))
            except sqlite3.IntegrityError:
                flash("An account with that email already exists.", "error")
            except ValueError as error:
                flash(str(error), "error")
        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            try:
                email = clean_email(request.form.get("email"), required=True)
            except ValueError:
                email = ""
            password = request.form.get("password", "")
            user = db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
            if user and bcrypt.checkpw(password.encode("utf-8"), user["password_hash"]):
                session.clear()
                session["user_id"] = user["id"]
                session["csrf_token"] = secrets.token_urlsafe(32)
                return redirect(url_for("invoices"))
            flash("Invalid email or password.", "error")
        return render_template("login.html")

    @app.route("/logout", methods=["POST"])
    @login_required
    def logout():
        session.clear()
        return redirect(url_for("login"))

    @app.route("/clients")
    @login_required
    def clients():
        rows = db().execute(
            "SELECT * FROM clients WHERE user_id = ? ORDER BY name COLLATE NOCASE", (g.user["id"],)
        ).fetchall()
        return render_template("clients.html", clients=rows)

    @app.route("/clients/new", methods=["GET", "POST"])
    @login_required
    def client_new():
        if request.method == "POST":
            try:
                name = clean_text(request.form.get("name"), "Name", 120, required=True)
                email = clean_email(request.form.get("email"))
                address = clean_text(request.form.get("address"), "Address", 1000)
                db().execute(
                    "INSERT INTO clients (user_id, name, email, address) VALUES (?, ?, ?, ?)",
                    (g.user["id"], name, email, address),
                )
                db().commit()
                return redirect(url_for("clients"))
            except ValueError as error:
                flash(str(error), "error")
        return render_template("client_form.html", client=None)

    @app.route("/clients/<int:client_id>/edit", methods=["GET", "POST"])
    @login_required
    def client_edit(client_id):
        client = get_client_owned(client_id)
        if request.method == "POST":
            try:
                name = clean_text(request.form.get("name"), "Name", 120, required=True)
                email = clean_email(request.form.get("email"))
                address = clean_text(request.form.get("address"), "Address", 1000)
                db().execute(
                    "UPDATE clients SET name = ?, email = ?, address = ? WHERE id = ? AND user_id = ?",
                    (name, email, address, client_id, g.user["id"]),
                )
                db().commit()
                return redirect(url_for("clients"))
            except ValueError as error:
                flash(str(error), "error")
        return render_template("client_form.html", client=client)

    @app.route("/clients/<int:client_id>/delete", methods=["POST"])
    @login_required
    def client_delete(client_id):
        get_client_owned(client_id)
        db().execute("DELETE FROM clients WHERE id = ? AND user_id = ?", (client_id, g.user["id"]))
        db().commit()
        return redirect(url_for("clients"))

    @app.route("/invoices")
    @login_required
    def invoices():
        rows = db().execute(
            """
            SELECT invoices.*, clients.name AS client_name
            FROM invoices
            JOIN clients ON clients.id = invoices.client_id
            WHERE invoices.user_id = ?
            ORDER BY invoices.created_at DESC
            """,
            (g.user["id"],),
        ).fetchall()
        invoice_rows = []
        for row in rows:
            items = db().execute("SELECT * FROM line_items WHERE invoice_id = ?", (row["id"],)).fetchall()
            invoice_rows.append((row, invoice_totals(items, row["tax_rate"])))
        return render_template("invoices.html", invoice_rows=invoice_rows)

    @app.route("/invoices/new", methods=["GET", "POST"])
    @login_required
    def invoice_new():
        clients = db().execute(
            "SELECT id, name FROM clients WHERE user_id = ? ORDER BY name COLLATE NOCASE", (g.user["id"],)
        ).fetchall()
        if request.method == "POST":
            return save_invoice(None, clients)
        return render_template("invoice_form.html", invoice=None, clients=clients, items=[{}])

    @app.route("/invoices/<int:invoice_id>/edit", methods=["GET", "POST"])
    @login_required
    def invoice_edit(invoice_id):
        invoice = get_invoice_owned(invoice_id)
        clients = db().execute(
            "SELECT id, name FROM clients WHERE user_id = ? ORDER BY name COLLATE NOCASE", (g.user["id"],)
        ).fetchall()
        items = db().execute(
            "SELECT * FROM line_items WHERE invoice_id = ? ORDER BY id", (invoice_id,)
        ).fetchall()
        if request.method == "POST":
            return save_invoice(invoice, clients)
        return render_template("invoice_form.html", invoice=invoice, clients=clients, items=items)

    @app.route("/invoices/<int:invoice_id>")
    @login_required
    def invoice_print(invoice_id):
        invoice = get_invoice_owned(invoice_id)
        items = db().execute("SELECT * FROM line_items WHERE invoice_id = ? ORDER BY id", (invoice_id,)).fetchall()
        totals = invoice_totals(items, invoice["tax_rate"])
        return render_template("invoice_print.html", invoice=invoice, items=items, totals=totals)

    @app.route("/invoices/<int:invoice_id>/delete", methods=["POST"])
    @login_required
    def invoice_delete(invoice_id):
        get_invoice_owned(invoice_id)
        db().execute("DELETE FROM invoices WHERE id = ? AND user_id = ?", (invoice_id, g.user["id"]))
        db().commit()
        return redirect(url_for("invoices"))


def save_invoice(invoice, clients):
    try:
        client_id = int_id(request.form.get("client_id"))
        get_client_owned(client_id)
        invoice_number = clean_text(request.form.get("invoice_number"), "Invoice number", 40, required=True)
        issue_date = date_value(request.form.get("issue_date"), "Issue date", required=True)
        due_date = date_value(request.form.get("due_date"), "Due date")
        tax_rate = percent(request.form.get("tax_rate"))
        notes = clean_text(request.form.get("notes"), "Notes", 1000)
        descriptions = request.form.getlist("description")
        quantities = request.form.getlist("quantity")
        unit_prices = request.form.getlist("unit_price")
        if not (len(descriptions) == len(quantities) == len(unit_prices)):
            raise ValueError("Line items are incomplete")
        items = []
        for description, quantity, unit_price in zip(descriptions, quantities, unit_prices):
            description = clean_text(description, "Line item description", 200)
            if not description:
                continue
            qty = money(quantity, "Quantity", Decimal("0.01"), Decimal("99999.99"))
            price = money(unit_price, "Unit price")
            items.append({"description": description, "quantity": str(qty), "unit_price": str(price)})
        if not items:
            raise ValueError("Add at least one line item")

        conn = db()
        if invoice:
            conn.execute(
                """
                UPDATE invoices
                SET client_id = ?, invoice_number = ?, issue_date = ?, due_date = ?,
                    tax_rate = ?, notes = ?
                WHERE id = ? AND user_id = ?
                """,
                (
                    client_id,
                    invoice_number,
                    issue_date,
                    due_date,
                    str(tax_rate),
                    notes,
                    invoice["id"],
                    g.user["id"],
                ),
            )
            invoice_id = invoice["id"]
            conn.execute("DELETE FROM line_items WHERE invoice_id = ?", (invoice_id,))
        else:
            cursor = conn.execute(
                """
                INSERT INTO invoices
                    (user_id, client_id, invoice_number, issue_date, due_date, tax_rate, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (g.user["id"], client_id, invoice_number, issue_date, due_date, str(tax_rate), notes),
            )
            invoice_id = cursor.lastrowid

        conn.executemany(
            "INSERT INTO line_items (invoice_id, description, quantity, unit_price) VALUES (?, ?, ?, ?)",
            [(invoice_id, item["description"], item["quantity"], item["unit_price"]) for item in items],
        )
        conn.commit()
        return redirect(url_for("invoice_print", invoice_id=invoice_id))
    except sqlite3.IntegrityError:
        db().rollback()
        flash("Invoice number must be unique.", "error")
    except ValueError as error:
        db().rollback()
        flash(str(error), "error")
    invoice_items = [
        {"description": d, "quantity": q, "unit_price": p}
        for d, q, p in zip(
            request.form.getlist("description"),
            request.form.getlist("quantity"),
            request.form.getlist("unit_price"),
        )
    ] or [{}]
    return render_template("invoice_form.html", invoice=invoice, clients=clients, items=invoice_items)


app = create_app()
app.jinja_env.globals["csrf_token"] = csrf_token


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5079)
