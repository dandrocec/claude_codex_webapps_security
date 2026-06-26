import os
import sqlite3
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
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


DATABASE = "invoices.sqlite"


def create_app():
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=os.environ.get("SECRET_KEY", "dev-change-me"),
        DATABASE=os.path.join(app.instance_path, DATABASE),
    )

    os.makedirs(app.instance_path, exist_ok=True)

    @app.before_request
    def load_logged_in_user():
        user_id = session.get("user_id")
        g.user = None
        if user_id is not None:
            g.user = query_one("SELECT id, email FROM users WHERE id = ?", (user_id,))

    @app.route("/")
    def index():
        if g.user:
            return redirect(url_for("dashboard"))
        return render_template("index.html")

    @app.route("/register", methods=("GET", "POST"))
    def register():
        if request.method == "POST":
            email = request.form["email"].strip().lower()
            password = request.form["password"]
            if not email or not password:
                flash("Email and password are required.")
            elif query_one("SELECT id FROM users WHERE email = ?", (email,)):
                flash("An account already exists for that email.")
            else:
                execute(
                    "INSERT INTO users (email, password_hash) VALUES (?, ?)",
                    (email, generate_password_hash(password)),
                )
                flash("Account created. Sign in to continue.")
                return redirect(url_for("login"))
        return render_template("auth.html", mode="register")

    @app.route("/login", methods=("GET", "POST"))
    def login():
        if request.method == "POST":
            email = request.form["email"].strip().lower()
            password = request.form["password"]
            user = query_one("SELECT * FROM users WHERE email = ?", (email,))
            if user and check_password_hash(user["password_hash"], password):
                session.clear()
                session["user_id"] = user["id"]
                return redirect(url_for("dashboard"))
            flash("Invalid email or password.")
        return render_template("auth.html", mode="login")

    @app.route("/logout", methods=("POST",))
    def logout():
        session.clear()
        return redirect(url_for("index"))

    @app.route("/dashboard")
    @login_required
    def dashboard():
        invoices = query_all(
            """
            SELECT invoices.*, clients.name AS client_name
            FROM invoices
            JOIN clients ON clients.id = invoices.client_id
            WHERE invoices.user_id = ?
            ORDER BY invoices.issue_date DESC, invoices.id DESC
            LIMIT 8
            """,
            (g.user["id"],),
        )
        stats = query_one(
            """
            SELECT
                COUNT(*) AS invoice_count,
                COALESCE(SUM(total_cents), 0) AS total_cents,
                COALESCE(SUM(CASE WHEN status = 'paid' THEN total_cents ELSE 0 END), 0) AS paid_cents
            FROM invoices
            WHERE user_id = ?
            """,
            (g.user["id"],),
        )
        client_count = query_one(
            "SELECT COUNT(*) AS count FROM clients WHERE user_id = ?", (g.user["id"],)
        )["count"]
        return render_template(
            "dashboard.html",
            invoices=invoices,
            stats=stats,
            client_count=client_count,
        )

    @app.route("/clients")
    @login_required
    def clients():
        rows = query_all(
            "SELECT * FROM clients WHERE user_id = ? ORDER BY name", (g.user["id"],)
        )
        return render_template("clients.html", clients=rows)

    @app.route("/clients/new", methods=("GET", "POST"))
    @login_required
    def client_new():
        if request.method == "POST":
            name = request.form["name"].strip()
            if not name:
                flash("Client name is required.")
            else:
                execute(
                    """
                    INSERT INTO clients (user_id, name, email, address, tax_id)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        g.user["id"],
                        name,
                        request.form["email"].strip(),
                        request.form["address"].strip(),
                        request.form["tax_id"].strip(),
                    ),
                )
                return redirect(url_for("clients"))
        return render_template("client_form.html", client=None)

    @app.route("/clients/<int:client_id>/edit", methods=("GET", "POST"))
    @login_required
    def client_edit(client_id):
        client = owned_client(client_id)
        if request.method == "POST":
            name = request.form["name"].strip()
            if not name:
                flash("Client name is required.")
            else:
                execute(
                    """
                    UPDATE clients
                    SET name = ?, email = ?, address = ?, tax_id = ?
                    WHERE id = ? AND user_id = ?
                    """,
                    (
                        name,
                        request.form["email"].strip(),
                        request.form["address"].strip(),
                        request.form["tax_id"].strip(),
                        client_id,
                        g.user["id"],
                    ),
                )
                return redirect(url_for("clients"))
        return render_template("client_form.html", client=client)

    @app.route("/invoices")
    @login_required
    def invoices():
        rows = query_all(
            """
            SELECT invoices.*, clients.name AS client_name
            FROM invoices
            JOIN clients ON clients.id = invoices.client_id
            WHERE invoices.user_id = ?
            ORDER BY invoices.issue_date DESC, invoices.id DESC
            """,
            (g.user["id"],),
        )
        return render_template("invoices.html", invoices=rows)

    @app.route("/invoices/new", methods=("GET", "POST"))
    @login_required
    def invoice_new():
        clients = query_all(
            "SELECT id, name FROM clients WHERE user_id = ? ORDER BY name", (g.user["id"],)
        )
        if not clients:
            flash("Create a client before creating an invoice.")
            return redirect(url_for("client_new"))
        if request.method == "POST":
            return save_invoice()
        return render_template(
            "invoice_form.html",
            invoice=None,
            clients=clients,
            today=date.today().isoformat(),
            lines=[{}],
        )

    @app.route("/invoices/<int:invoice_id>/edit", methods=("GET", "POST"))
    @login_required
    def invoice_edit(invoice_id):
        invoice = owned_invoice(invoice_id)
        clients = query_all(
            "SELECT id, name FROM clients WHERE user_id = ? ORDER BY name", (g.user["id"],)
        )
        if request.method == "POST":
            return save_invoice(invoice_id)
        lines = query_all(
            "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id", (invoice_id,)
        )
        return render_template(
            "invoice_form.html",
            invoice=invoice,
            clients=clients,
            today=date.today().isoformat(),
            lines=lines,
        )

    @app.route("/invoices/<int:invoice_id>")
    @login_required
    def invoice_print(invoice_id):
        invoice = owned_invoice(invoice_id)
        client = owned_client(invoice["client_id"])
        lines = query_all(
            "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id", (invoice_id,)
        )
        return render_template("invoice_print.html", invoice=invoice, client=client, lines=lines)

    @app.cli.command("init-db")
    def init_db_command():
        init_db()
        print("Initialized the database.")

    with app.app_context():
        init_db()

    return app


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(current_app_database())
        g.db.row_factory = sqlite3.Row
    return g.db


def current_app_database():
    from flask import current_app

    return current_app.config["DATABASE"]


def query_one(sql, params=()):
    return get_db().execute(sql, params).fetchone()


def query_all(sql, params=()):
    return get_db().execute(sql, params).fetchall()


def execute(sql, params=()):
    db = get_db()
    cur = db.execute(sql, params)
    db.commit()
    return cur.lastrowid


def init_db():
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS clients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            email TEXT,
            address TEXT,
            tax_id TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            client_id INTEGER NOT NULL,
            invoice_number TEXT NOT NULL,
            issue_date TEXT NOT NULL,
            due_date TEXT,
            status TEXT NOT NULL DEFAULT 'draft',
            notes TEXT,
            tax_rate TEXT NOT NULL DEFAULT '0',
            subtotal_cents INTEGER NOT NULL DEFAULT 0,
            tax_cents INTEGER NOT NULL DEFAULT 0,
            total_cents INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
            FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
            UNIQUE (user_id, invoice_number)
        );

        CREATE TABLE IF NOT EXISTS invoice_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_id INTEGER NOT NULL,
            description TEXT NOT NULL,
            quantity TEXT NOT NULL,
            unit_price_cents INTEGER NOT NULL,
            line_total_cents INTEGER NOT NULL,
            FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE CASCADE
        );
        """
    )
    db.commit()


def login_required(view):
    @wraps(view)
    def wrapped_view(**kwargs):
        if g.user is None:
            return redirect(url_for("login"))
        return view(**kwargs)

    return wrapped_view


def owned_client(client_id):
    client = query_one(
        "SELECT * FROM clients WHERE id = ? AND user_id = ?", (client_id, g.user["id"])
    )
    if client is None:
        abort(404)
    return client


def owned_invoice(invoice_id):
    invoice = query_one(
        "SELECT * FROM invoices WHERE id = ? AND user_id = ?", (invoice_id, g.user["id"])
    )
    if invoice is None:
        abort(404)
    return invoice


def save_invoice(invoice_id=None):
    client_id = int(request.form["client_id"])
    owned_client(client_id)
    invoice_number = request.form["invoice_number"].strip()
    issue_date = request.form["issue_date"] or date.today().isoformat()
    due_date = request.form["due_date"].strip()
    status = request.form["status"]
    notes = request.form["notes"].strip()
    tax_rate = money_decimal(request.form["tax_rate"] or "0")
    lines = parse_lines(request.form)

    if not invoice_number:
        flash("Invoice number is required.")
        return redirect(request.url)
    if not lines:
        flash("Add at least one line item.")
        return redirect(request.url)

    subtotal = sum((line["line_total"] for line in lines), Decimal("0.00"))
    tax = (subtotal * tax_rate / Decimal("100")).quantize(Decimal("0.01"), ROUND_HALF_UP)
    total = subtotal + tax

    try:
        if invoice_id is None:
            invoice_id = execute(
                """
                INSERT INTO invoices
                    (user_id, client_id, invoice_number, issue_date, due_date, status, notes,
                     tax_rate, subtotal_cents, tax_cents, total_cents)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    g.user["id"],
                    client_id,
                    invoice_number,
                    issue_date,
                    due_date,
                    status,
                    notes,
                    str(tax_rate),
                    cents(subtotal),
                    cents(tax),
                    cents(total),
                ),
            )
        else:
            owned_invoice(invoice_id)
            execute(
                """
                UPDATE invoices
                SET client_id = ?, invoice_number = ?, issue_date = ?, due_date = ?,
                    status = ?, notes = ?, tax_rate = ?, subtotal_cents = ?,
                    tax_cents = ?, total_cents = ?
                WHERE id = ? AND user_id = ?
                """,
                (
                    client_id,
                    invoice_number,
                    issue_date,
                    due_date,
                    status,
                    notes,
                    str(tax_rate),
                    cents(subtotal),
                    cents(tax),
                    cents(total),
                    invoice_id,
                    g.user["id"],
                ),
            )
            execute("DELETE FROM invoice_items WHERE invoice_id = ?", (invoice_id,))
    except sqlite3.IntegrityError:
        flash("Invoice number must be unique for your account.")
        return redirect(request.url)

    for line in lines:
        execute(
            """
            INSERT INTO invoice_items
                (invoice_id, description, quantity, unit_price_cents, line_total_cents)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                invoice_id,
                line["description"],
                str(line["quantity"]),
                cents(line["unit_price"]),
                cents(line["line_total"]),
            ),
        )
    return redirect(url_for("invoice_print", invoice_id=invoice_id))


def parse_lines(form):
    descriptions = form.getlist("description")
    quantities = form.getlist("quantity")
    prices = form.getlist("unit_price")
    lines = []
    for description, quantity, unit_price in zip(descriptions, quantities, prices):
        description = description.strip()
        if not description:
            continue
        qty = money_decimal(quantity or "0")
        price = money_decimal(unit_price or "0")
        if qty <= 0 or price < 0:
            continue
        lines.append(
            {
                "description": description,
                "quantity": qty,
                "unit_price": price,
                "line_total": (qty * price).quantize(Decimal("0.01"), ROUND_HALF_UP),
            }
        )
    return lines


def money_decimal(value):
    try:
        return Decimal(str(value)).quantize(Decimal("0.01"), ROUND_HALF_UP)
    except Exception:
        return Decimal("0.00")


def cents(amount):
    return int((amount * 100).quantize(Decimal("1"), ROUND_HALF_UP))


def dollars(cents_value):
    return f"${Decimal(cents_value or 0) / Decimal(100):,.2f}"


app = create_app()
app.jinja_env.filters["money"] = dollars


@app.teardown_appcontext
def close_db(error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()
