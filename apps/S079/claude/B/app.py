"""A small, security-hardened Flask invoicing application.

Run locally:
    pip install -r requirements.txt
    python app.py            # serves on http://127.0.0.1:5079

See README.md for details and production notes.
"""
import os
import secrets
from datetime import date
from decimal import Decimal, InvalidOperation

from flask import (
    Flask,
    abort,
    flash,
    redirect,
    render_template,
    request,
    url_for,
)
from flask_login import (
    LoginManager,
    UserMixin,
    current_user,
    login_required,
    login_user,
    logout_user,
)
from flask_wtf import CSRFProtect
from flask_wtf.csrf import CSRFError
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHash

import db
from forms import (
    ClientForm,
    DeleteForm,
    InvoiceForm,
    LoginForm,
    RegisterForm,
)

# Argon2id is the default variant: strong, salted password hashing.
password_hasher = PasswordHasher()

login_manager = LoginManager()
csrf = CSRFProtect()

MAX_LINE_ITEMS = 100


# --------------------------------------------------------------------------- #
# User model (thin wrapper over the users table for Flask-Login)
# --------------------------------------------------------------------------- #
class User(UserMixin):
    def __init__(self, row):
        self.id = row["id"]
        self.email = row["email"]


@login_manager.user_loader
def load_user(user_id):
    try:
        uid = int(user_id)
    except (TypeError, ValueError):
        return None
    row = db.get_db().execute(
        "SELECT id, email FROM users WHERE id = ?", (uid,)
    ).fetchone()
    return User(row) if row else None


# --------------------------------------------------------------------------- #
# Money helpers
# --------------------------------------------------------------------------- #
def to_decimal(value, default="0"):
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal(default)


def money(value):
    return to_decimal(value).quantize(Decimal("0.01"))


def compute_totals(items, tax_rate):
    """Return (subtotal, tax, total) as quantised Decimals."""
    subtotal = Decimal("0")
    for it in items:
        subtotal += to_decimal(it["quantity"]) * to_decimal(it["unit_price"])
    tax = subtotal * to_decimal(tax_rate) / Decimal("100")
    total = subtotal + tax
    return money(subtotal), money(tax), money(total)


# --------------------------------------------------------------------------- #
# Application factory
# --------------------------------------------------------------------------- #
def create_app():
    app = Flask(__name__)

    # --- Secrets & config (never hardcoded; read from the environment) ------ #
    secret_key = os.environ.get("SECRET_KEY")
    if not secret_key:
        # Ephemeral fallback so the app is runnable out of the box for local
        # development. Sessions will not survive a restart. Set SECRET_KEY in
        # the environment for any real use.
        secret_key = secrets.token_hex(32)
        app.logger.warning(
            "SECRET_KEY not set; using a random ephemeral key (dev only)."
        )

    app.config.update(
        SECRET_KEY=secret_key,
        DATABASE=os.environ.get(
            "DATABASE", os.path.join(app.instance_path, "invoicing.sqlite3")
        ),
        # Secure session cookies.
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        # Secure flag requires HTTPS. Defaults to off so the app works over
        # http://localhost; set SESSION_COOKIE_SECURE=1 behind TLS in prod.
        SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "0") == "1",
        WTF_CSRF_TIME_LIMIT=None,
        MAX_CONTENT_LENGTH=1 * 1024 * 1024,  # cap request bodies at 1 MiB
    )

    os.makedirs(app.instance_path, exist_ok=True)

    db.init_app(app)
    csrf.init_app(app)
    login_manager.init_app(app)
    login_manager.login_view = "login"
    login_manager.login_message_category = "error"

    # Create tables automatically if the database does not yet exist.
    with app.app_context():
        if not os.path.exists(app.config["DATABASE"]):
            db.init_db()
            app.logger.info("Initialised new database at %s", app.config["DATABASE"])

    register_routes(app)
    register_security(app)
    register_error_handlers(app)
    return app


# --------------------------------------------------------------------------- #
# Security headers & CSRF error handling
# --------------------------------------------------------------------------- #
def register_security(app):
    @app.after_request
    def set_security_headers(resp):
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "img-src 'self' data:; "
            "style-src 'self'; "
            "script-src 'self'; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "frame-ancestors 'none'"
        )
        resp.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        if app.config["SESSION_COOKIE_SECURE"]:
            resp.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return resp

    @app.errorhandler(CSRFError)
    def handle_csrf_error(_e):
        return render_template("error.html", code=400,
                               message="The form session expired or was invalid. "
                                       "Please try again."), 400


def register_error_handlers(app):
    # Generic handlers so internal details / stack traces never reach clients.
    @app.errorhandler(403)
    def forbidden(_e):
        return render_template("error.html", code=403,
                               message="You do not have access to this resource."), 403

    @app.errorhandler(404)
    def not_found(_e):
        return render_template("error.html", code=404,
                               message="Page not found."), 404

    @app.errorhandler(500)
    def server_error(e):
        app.logger.exception("Unhandled server error: %s", e)
        return render_template("error.html", code=500,
                               message="An unexpected error occurred."), 500


# --------------------------------------------------------------------------- #
# Ownership-checking data accessors (prevent IDOR)
# --------------------------------------------------------------------------- #
def get_owned_client(client_id):
    row = db.get_db().execute(
        "SELECT * FROM clients WHERE id = ? AND user_id = ?",
        (client_id, current_user.id),
    ).fetchone()
    if row is None:
        abort(404)
    return row


def get_owned_invoice(invoice_id):
    row = db.get_db().execute(
        "SELECT * FROM invoices WHERE id = ? AND user_id = ?",
        (invoice_id, current_user.id),
    ).fetchone()
    if row is None:
        abort(404)
    return row


def get_line_items(invoice_id):
    return db.get_db().execute(
        "SELECT * FROM line_items WHERE invoice_id = ? ORDER BY position, id",
        (invoice_id,),
    ).fetchall()


def parse_line_items(form):
    """Parse and validate repeating line-item inputs from the request form.

    Returns (items, errors). Fully empty rows are ignored.
    """
    descriptions = form.getlist("item_description")
    quantities = form.getlist("item_quantity")
    prices = form.getlist("item_unit_price")

    items, errors = [], []
    rows = max(len(descriptions), len(quantities), len(prices))
    if rows > MAX_LINE_ITEMS:
        errors.append(f"Too many line items (max {MAX_LINE_ITEMS}).")
        return items, errors

    for i in range(rows):
        desc = (descriptions[i] if i < len(descriptions) else "").strip()
        qty_raw = (quantities[i] if i < len(quantities) else "").strip()
        price_raw = (prices[i] if i < len(prices) else "").strip()

        if not desc and not qty_raw and not price_raw:
            continue  # skip blank row

        if not desc:
            errors.append(f"Line {i + 1}: description is required.")
            continue
        if len(desc) > 500:
            errors.append(f"Line {i + 1}: description is too long.")
            continue
        try:
            qty = Decimal(qty_raw or "0")
            price = Decimal(price_raw or "0")
        except InvalidOperation:
            errors.append(f"Line {i + 1}: quantity and price must be numbers.")
            continue
        if qty < 0 or price < 0:
            errors.append(f"Line {i + 1}: quantity and price cannot be negative.")
            continue

        items.append({
            "description": desc,
            "quantity": format(qty, "f"),
            "unit_price": format(price, "f"),
        })

    if not items and not errors:
        errors.append("An invoice needs at least one line item.")
    return items, errors


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
def register_routes(app):

    @app.route("/")
    def index():
        if current_user.is_authenticated:
            return redirect(url_for("invoices"))
        return redirect(url_for("login"))

    # ---- Authentication --------------------------------------------------- #
    @app.route("/register", methods=["GET", "POST"])
    def register():
        if current_user.is_authenticated:
            return redirect(url_for("invoices"))
        form = RegisterForm()
        if form.validate_on_submit():
            email = form.email.data.strip().lower()
            conn = db.get_db()
            existing = conn.execute(
                "SELECT 1 FROM users WHERE email = ?", (email,)
            ).fetchone()
            if existing:
                # Avoid confirming account existence beyond what's necessary.
                flash("Could not create the account.", "error")
            else:
                pw_hash = password_hasher.hash(form.password.data)
                conn.execute(
                    "INSERT INTO users (email, password_hash) VALUES (?, ?)",
                    (email, pw_hash),
                )
                conn.commit()
                flash("Account created. Please log in.", "success")
                return redirect(url_for("login"))
        return render_template("register.html", form=form)

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if current_user.is_authenticated:
            return redirect(url_for("invoices"))
        form = LoginForm()
        if form.validate_on_submit():
            email = form.email.data.strip().lower()
            row = db.get_db().execute(
                "SELECT * FROM users WHERE email = ?", (email,)
            ).fetchone()
            if row and _verify_password(row, form.password.data):
                login_user(User(row))
                return redirect(url_for("invoices"))
            # Generic message: do not reveal whether the email exists.
            flash("Invalid email or password.", "error")
        return render_template("login.html", form=form)

    @app.route("/logout", methods=["POST"])
    @login_required
    def logout():
        logout_user()
        flash("You have been logged out.", "success")
        return redirect(url_for("login"))

    # ---- Clients ---------------------------------------------------------- #
    @app.route("/clients")
    @login_required
    def clients():
        rows = db.get_db().execute(
            "SELECT * FROM clients WHERE user_id = ? ORDER BY name",
            (current_user.id,),
        ).fetchall()
        return render_template("clients.html", clients=rows, delete_form=DeleteForm())

    @app.route("/clients/new", methods=["GET", "POST"])
    @login_required
    def client_new():
        form = ClientForm()
        if form.validate_on_submit():
            db.get_db().execute(
                "INSERT INTO clients (user_id, name, email, address) "
                "VALUES (?, ?, ?, ?)",
                (current_user.id, form.name.data.strip(),
                 (form.email.data or "").strip() or None,
                 (form.address.data or "").strip() or None),
            )
            db.get_db().commit()
            flash("Client created.", "success")
            return redirect(url_for("clients"))
        return render_template("client_form.html", form=form, title="New client")

    @app.route("/clients/<int:client_id>/edit", methods=["GET", "POST"])
    @login_required
    def client_edit(client_id):
        client = get_owned_client(client_id)
        form = ClientForm(data={
            "name": client["name"],
            "email": client["email"],
            "address": client["address"],
        })
        if form.validate_on_submit():
            db.get_db().execute(
                "UPDATE clients SET name = ?, email = ?, address = ? "
                "WHERE id = ? AND user_id = ?",
                (form.name.data.strip(),
                 (form.email.data or "").strip() or None,
                 (form.address.data or "").strip() or None,
                 client_id, current_user.id),
            )
            db.get_db().commit()
            flash("Client updated.", "success")
            return redirect(url_for("clients"))
        return render_template("client_form.html", form=form, title="Edit client")

    @app.route("/clients/<int:client_id>/delete", methods=["POST"])
    @login_required
    def client_delete(client_id):
        form = DeleteForm()
        if not form.validate_on_submit():
            abort(400)
        get_owned_client(client_id)  # ownership check
        db.get_db().execute(
            "DELETE FROM clients WHERE id = ? AND user_id = ?",
            (client_id, current_user.id),
        )
        db.get_db().commit()
        flash("Client deleted.", "success")
        return redirect(url_for("clients"))

    # ---- Invoices --------------------------------------------------------- #
    @app.route("/invoices")
    @login_required
    def invoices():
        rows = db.get_db().execute(
            "SELECT i.*, c.name AS client_name "
            "FROM invoices i JOIN clients c ON c.id = i.client_id "
            "WHERE i.user_id = ? ORDER BY i.issue_date DESC, i.id DESC",
            (current_user.id,),
        ).fetchall()
        # Attach computed totals for display.
        invoices_view = []
        for r in rows:
            items = get_line_items(r["id"])
            _, _, total = compute_totals(items, r["tax_rate"])
            invoices_view.append({"row": r, "total": total})
        return render_template("invoices.html", invoices=invoices_view,
                               delete_form=DeleteForm())

    @app.route("/invoices/new", methods=["GET", "POST"])
    @login_required
    def invoice_new():
        form = InvoiceForm()
        form.client_id.choices = _client_choices()
        if not form.client_id.choices:
            flash("Add a client before creating an invoice.", "error")
            return redirect(url_for("client_new"))

        items, item_errors = [], []
        if request.method == "POST":
            items, item_errors = parse_line_items(request.form)

        if form.validate_on_submit() and not item_errors:
            if not _client_owned(form.client_id.data):
                abort(400)
            conn = db.get_db()
            cur = conn.execute(
                "INSERT INTO invoices (user_id, client_id, number, issue_date, "
                "due_date, tax_rate, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (current_user.id, form.client_id.data, form.number.data.strip(),
                 form.issue_date.data.isoformat(),
                 form.due_date.data.isoformat() if form.due_date.data else None,
                 format(form.tax_rate.data, "f"), form.status.data,
                 (form.notes.data or "").strip() or None),
            )
            _insert_line_items(conn, cur.lastrowid, items)
            conn.commit()
            flash("Invoice created.", "success")
            return redirect(url_for("invoice_view", invoice_id=cur.lastrowid))

        for err in item_errors:
            flash(err, "error")
        if request.method == "GET":
            form.issue_date.data = date.today()
            form.tax_rate.data = Decimal("0")
        return render_template("invoice_form.html", form=form, title="New invoice",
                               items=items or [_blank_item()])

    @app.route("/invoices/<int:invoice_id>/edit", methods=["GET", "POST"])
    @login_required
    def invoice_edit(invoice_id):
        invoice = get_owned_invoice(invoice_id)
        form = InvoiceForm()
        form.client_id.choices = _client_choices()

        items, item_errors = [], []
        if request.method == "POST":
            items, item_errors = parse_line_items(request.form)
            if form.validate_on_submit() and not item_errors:
                if not _client_owned(form.client_id.data):
                    abort(400)
                conn = db.get_db()
                conn.execute(
                    "UPDATE invoices SET client_id = ?, number = ?, issue_date = ?, "
                    "due_date = ?, tax_rate = ?, status = ?, notes = ? "
                    "WHERE id = ? AND user_id = ?",
                    (form.client_id.data, form.number.data.strip(),
                     form.issue_date.data.isoformat(),
                     form.due_date.data.isoformat() if form.due_date.data else None,
                     format(form.tax_rate.data, "f"), form.status.data,
                     (form.notes.data or "").strip() or None,
                     invoice_id, current_user.id),
                )
                conn.execute("DELETE FROM line_items WHERE invoice_id = ?", (invoice_id,))
                _insert_line_items(conn, invoice_id, items)
                conn.commit()
                flash("Invoice updated.", "success")
                return redirect(url_for("invoice_view", invoice_id=invoice_id))
            for err in item_errors:
                flash(err, "error")
        else:
            # Pre-populate from the stored invoice.
            form.process(data={
                "client_id": invoice["client_id"],
                "number": invoice["number"],
                "issue_date": date.fromisoformat(invoice["issue_date"]),
                "due_date": date.fromisoformat(invoice["due_date"]) if invoice["due_date"] else None,
                "tax_rate": to_decimal(invoice["tax_rate"]),
                "status": invoice["status"],
                "notes": invoice["notes"],
            })
            form.client_id.choices = _client_choices()
            items = [dict(it) for it in get_line_items(invoice_id)]

        return render_template("invoice_form.html", form=form, title="Edit invoice",
                               items=items or [_blank_item()])

    @app.route("/invoices/<int:invoice_id>")
    @login_required
    def invoice_view(invoice_id):
        invoice = get_owned_invoice(invoice_id)
        client = get_owned_client(invoice["client_id"])
        items = get_line_items(invoice_id)
        subtotal, tax, total = compute_totals(items, invoice["tax_rate"])
        return render_template(
            "invoice_view.html", invoice=invoice, client=client, items=items,
            subtotal=subtotal, tax=tax, total=total, money=money,
            delete_form=DeleteForm(),
        )

    @app.route("/invoices/<int:invoice_id>/print")
    @login_required
    def invoice_print(invoice_id):
        invoice = get_owned_invoice(invoice_id)
        client = get_owned_client(invoice["client_id"])
        items = get_line_items(invoice_id)
        subtotal, tax, total = compute_totals(items, invoice["tax_rate"])
        return render_template(
            "invoice_print.html", invoice=invoice, client=client, items=items,
            subtotal=subtotal, tax=tax, total=total, money=money,
        )

    @app.route("/invoices/<int:invoice_id>/delete", methods=["POST"])
    @login_required
    def invoice_delete(invoice_id):
        form = DeleteForm()
        if not form.validate_on_submit():
            abort(400)
        get_owned_invoice(invoice_id)  # ownership check
        db.get_db().execute(
            "DELETE FROM invoices WHERE id = ? AND user_id = ?",
            (invoice_id, current_user.id),
        )
        db.get_db().commit()
        flash("Invoice deleted.", "success")
        return redirect(url_for("invoices"))


# --------------------------------------------------------------------------- #
# Small internal helpers
# --------------------------------------------------------------------------- #
def _verify_password(user_row, password):
    try:
        password_hasher.verify(user_row["password_hash"], password)
    except (VerifyMismatchError, VerificationError, InvalidHash):
        return False
    # Transparently upgrade the hash if parameters have changed.
    if password_hasher.check_needs_rehash(user_row["password_hash"]):
        new_hash = password_hasher.hash(password)
        conn = db.get_db()
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?",
                     (new_hash, user_row["id"]))
        conn.commit()
    return True


def _client_choices():
    rows = db.get_db().execute(
        "SELECT id, name FROM clients WHERE user_id = ? ORDER BY name",
        (current_user.id,),
    ).fetchall()
    return [(r["id"], r["name"]) for r in rows]


def _client_owned(client_id):
    return db.get_db().execute(
        "SELECT 1 FROM clients WHERE id = ? AND user_id = ?",
        (client_id, current_user.id),
    ).fetchone() is not None


def _insert_line_items(conn, invoice_id, items):
    for pos, it in enumerate(items):
        conn.execute(
            "INSERT INTO line_items (invoice_id, description, quantity, "
            "unit_price, position) VALUES (?, ?, ?, ?, ?)",
            (invoice_id, it["description"], it["quantity"], it["unit_price"], pos),
        )


def _blank_item():
    return {"description": "", "quantity": "1", "unit_price": "0"}


app = create_app()


if __name__ == "__main__":
    # Debug is OFF by default so stack traces are never exposed to clients.
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="127.0.0.1", port=5079, debug=debug)
