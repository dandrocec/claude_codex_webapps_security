"""A small multi-user invoicing application built with Flask + SQLite.

Run with:  python app.py   (serves on http://127.0.0.1:5079)
"""
import os
from datetime import datetime, date
from functools import wraps

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
    current_user,
    login_required,
    login_user,
    logout_user,
)

from models import Client, Invoice, LineItem, User, db

BASE_DIR = os.path.abspath(os.path.dirname(__file__))


def create_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-change-me-in-prod")
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + os.path.join(
        BASE_DIR, "invoicing.db"
    )
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    db.init_app(app)

    login_manager = LoginManager()
    login_manager.login_view = "login"
    login_manager.login_message_category = "error"
    login_manager.init_app(app)

    @login_manager.user_loader
    def load_user(user_id):
        return db.session.get(User, int(user_id))

    register_routes(app)

    with app.app_context():
        db.create_all()

    return app


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def get_owned_or_404(model, obj_id):
    """Fetch a row by id but only if it belongs to the logged-in user."""
    obj = db.session.get(model, obj_id)
    if obj is None or obj.user_id != current_user.id:
        abort(404)
    return obj


def parse_date(value):
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def parse_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
def register_routes(app):
    @app.route("/")
    def index():
        if current_user.is_authenticated:
            return redirect(url_for("list_invoices"))
        return redirect(url_for("login"))

    # ----- Auth -----------------------------------------------------------
    @app.route("/register", methods=["GET", "POST"])
    def register():
        if current_user.is_authenticated:
            return redirect(url_for("list_invoices"))
        if request.method == "POST":
            email = (request.form.get("email") or "").strip().lower()
            password = request.form.get("password") or ""
            if not email or not password:
                flash("Email and password are required.", "error")
            elif User.query.filter_by(email=email).first():
                flash("An account with that email already exists.", "error")
            else:
                user = User(email=email)
                user.set_password(password)
                db.session.add(user)
                db.session.commit()
                login_user(user)
                flash("Welcome! Your account has been created.", "success")
                return redirect(url_for("list_invoices"))
        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if current_user.is_authenticated:
            return redirect(url_for("list_invoices"))
        if request.method == "POST":
            email = (request.form.get("email") or "").strip().lower()
            password = request.form.get("password") or ""
            user = User.query.filter_by(email=email).first()
            if user and user.check_password(password):
                login_user(user)
                next_url = request.args.get("next")
                return redirect(next_url or url_for("list_invoices"))
            flash("Invalid email or password.", "error")
        return render_template("login.html")

    @app.route("/logout")
    @login_required
    def logout():
        logout_user()
        return redirect(url_for("login"))

    # ----- Clients --------------------------------------------------------
    @app.route("/clients")
    @login_required
    def list_clients():
        clients = (
            Client.query.filter_by(user_id=current_user.id)
            .order_by(Client.name)
            .all()
        )
        return render_template("clients.html", clients=clients)

    @app.route("/clients/new", methods=["GET", "POST"])
    @login_required
    def new_client():
        if request.method == "POST":
            name = (request.form.get("name") or "").strip()
            if not name:
                flash("Client name is required.", "error")
                return render_template("client_form.html", client=None)
            client = Client(
                user_id=current_user.id,
                name=name,
                email=(request.form.get("email") or "").strip(),
                address=(request.form.get("address") or "").strip(),
            )
            db.session.add(client)
            db.session.commit()
            flash("Client created.", "success")
            return redirect(url_for("list_clients"))
        return render_template("client_form.html", client=None)

    @app.route("/clients/<int:client_id>/edit", methods=["GET", "POST"])
    @login_required
    def edit_client(client_id):
        client = get_owned_or_404(Client, client_id)
        if request.method == "POST":
            name = (request.form.get("name") or "").strip()
            if not name:
                flash("Client name is required.", "error")
                return render_template("client_form.html", client=client)
            client.name = name
            client.email = (request.form.get("email") or "").strip()
            client.address = (request.form.get("address") or "").strip()
            db.session.commit()
            flash("Client updated.", "success")
            return redirect(url_for("list_clients"))
        return render_template("client_form.html", client=client)

    @app.route("/clients/<int:client_id>/delete", methods=["POST"])
    @login_required
    def delete_client(client_id):
        client = get_owned_or_404(Client, client_id)
        db.session.delete(client)
        db.session.commit()
        flash("Client deleted.", "success")
        return redirect(url_for("list_clients"))

    # ----- Invoices -------------------------------------------------------
    @app.route("/invoices")
    @login_required
    def list_invoices():
        invoices = (
            Invoice.query.filter_by(user_id=current_user.id)
            .order_by(Invoice.created_at.desc())
            .all()
        )
        return render_template("invoices.html", invoices=invoices)

    @app.route("/invoices/new", methods=["GET", "POST"])
    @login_required
    def new_invoice():
        clients = (
            Client.query.filter_by(user_id=current_user.id)
            .order_by(Client.name)
            .all()
        )
        if not clients:
            flash("Create a client before creating an invoice.", "error")
            return redirect(url_for("new_client"))

        if request.method == "POST":
            invoice = _save_invoice_from_form(None)
            if invoice is not None:
                flash("Invoice created.", "success")
                return redirect(url_for("view_invoice", invoice_id=invoice.id))

        # Suggest the next invoice number for convenience.
        suggested = "INV-{:04d}".format(
            Invoice.query.filter_by(user_id=current_user.id).count() + 1
        )
        return render_template(
            "invoice_form.html",
            invoice=None,
            clients=clients,
            suggested_number=suggested,
            today=date.today().isoformat(),
        )

    @app.route("/invoices/<int:invoice_id>/edit", methods=["GET", "POST"])
    @login_required
    def edit_invoice(invoice_id):
        invoice = get_owned_or_404(Invoice, invoice_id)
        clients = (
            Client.query.filter_by(user_id=current_user.id)
            .order_by(Client.name)
            .all()
        )
        if request.method == "POST":
            updated = _save_invoice_from_form(invoice)
            if updated is not None:
                flash("Invoice updated.", "success")
                return redirect(url_for("view_invoice", invoice_id=invoice.id))
        return render_template(
            "invoice_form.html",
            invoice=invoice,
            clients=clients,
            suggested_number=invoice.number,
            today=date.today().isoformat(),
        )

    @app.route("/invoices/<int:invoice_id>")
    @login_required
    def view_invoice(invoice_id):
        invoice = get_owned_or_404(Invoice, invoice_id)
        return render_template("invoice_detail.html", invoice=invoice)

    @app.route("/invoices/<int:invoice_id>/print")
    @login_required
    def print_invoice(invoice_id):
        invoice = get_owned_or_404(Invoice, invoice_id)
        return render_template("invoice_print.html", invoice=invoice)

    @app.route("/invoices/<int:invoice_id>/status", methods=["POST"])
    @login_required
    def update_status(invoice_id):
        invoice = get_owned_or_404(Invoice, invoice_id)
        status = request.form.get("status")
        if status in {"draft", "sent", "paid"}:
            invoice.status = status
            db.session.commit()
            flash("Status updated.", "success")
        return redirect(url_for("view_invoice", invoice_id=invoice.id))

    @app.route("/invoices/<int:invoice_id>/delete", methods=["POST"])
    @login_required
    def delete_invoice(invoice_id):
        invoice = get_owned_or_404(Invoice, invoice_id)
        db.session.delete(invoice)
        db.session.commit()
        flash("Invoice deleted.", "success")
        return redirect(url_for("list_invoices"))

    def _save_invoice_from_form(invoice):
        """Create or update an invoice from request.form. Returns the invoice
        on success, or None if validation failed (a flash is set)."""
        client_id = parse_float(request.form.get("client_id"), default=0)
        client = db.session.get(Client, int(client_id)) if client_id else None
        if client is None or client.user_id != current_user.id:
            flash("Please choose a valid client.", "error")
            return None

        number = (request.form.get("number") or "").strip()
        if not number:
            flash("Invoice number is required.", "error")
            return None

        # Collect parallel arrays of line item fields.
        descriptions = request.form.getlist("description")
        quantities = request.form.getlist("quantity")
        prices = request.form.getlist("unit_price")

        items = []
        for desc, qty, price in zip(descriptions, quantities, prices):
            desc = (desc or "").strip()
            if not desc:
                continue  # skip empty rows
            items.append(
                LineItem(
                    description=desc,
                    quantity=parse_float(qty, default=0),
                    unit_price=parse_float(price, default=0),
                )
            )

        if not items:
            flash("Add at least one line item.", "error")
            return None

        if invoice is None:
            invoice = Invoice(user_id=current_user.id)
            db.session.add(invoice)

        invoice.client_id = client.id
        invoice.number = number
        invoice.issue_date = parse_date(request.form.get("issue_date")) or date.today()
        invoice.due_date = parse_date(request.form.get("due_date"))
        invoice.tax_rate = parse_float(request.form.get("tax_rate"), default=0)
        invoice.notes = (request.form.get("notes") or "").strip()

        # Replace line items wholesale (simplest correct approach for edits).
        invoice.items.clear()
        for item in items:
            invoice.items.append(item)

        db.session.commit()
        return invoice

    @app.template_filter("money")
    def money_filter(value):
        return "{:,.2f}".format(float(value or 0))


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5079, debug=True)
