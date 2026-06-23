"""Database models for the invoicing app."""
from datetime import datetime, date
from decimal import Decimal, ROUND_HALF_UP

from flask_login import UserMixin
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import check_password_hash, generate_password_hash

db = SQLAlchemy()

# Money values are stored as floats in SQLite but all arithmetic is done with
# Decimal to avoid binary floating point rounding surprises on currency.
TWO_PLACES = Decimal("0.01")


def money(value):
    """Round a numeric value to 2 decimal places using banker-free rounding."""
    return Decimal(str(value or 0)).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


class User(UserMixin, db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    clients = db.relationship(
        "Client", backref="owner", cascade="all, delete-orphan", lazy=True
    )
    invoices = db.relationship(
        "Invoice", backref="owner", cascade="all, delete-orphan", lazy=True
    )

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Client(db.Model):
    __tablename__ = "clients"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(
        db.Integer, db.ForeignKey("users.id"), nullable=False, index=True
    )
    name = db.Column(db.String(255), nullable=False)
    email = db.Column(db.String(255))
    address = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    invoices = db.relationship(
        "Invoice", backref="client", cascade="all, delete-orphan", lazy=True
    )


class Invoice(db.Model):
    __tablename__ = "invoices"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(
        db.Integer, db.ForeignKey("users.id"), nullable=False, index=True
    )
    client_id = db.Column(
        db.Integer, db.ForeignKey("clients.id"), nullable=False, index=True
    )
    number = db.Column(db.String(64), nullable=False)
    issue_date = db.Column(db.Date, default=date.today)
    due_date = db.Column(db.Date)
    tax_rate = db.Column(db.Float, default=0.0)  # percent, e.g. 20 for 20%
    notes = db.Column(db.Text)
    status = db.Column(db.String(32), default="draft")  # draft | sent | paid
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    items = db.relationship(
        "LineItem",
        backref="invoice",
        cascade="all, delete-orphan",
        lazy=True,
        order_by="LineItem.id",
    )

    @property
    def subtotal(self):
        return money(sum(item.amount for item in self.items))

    @property
    def tax_amount(self):
        return money(self.subtotal * Decimal(str(self.tax_rate or 0)) / Decimal("100"))

    @property
    def total(self):
        return money(self.subtotal + self.tax_amount)


class LineItem(db.Model):
    __tablename__ = "line_items"

    id = db.Column(db.Integer, primary_key=True)
    invoice_id = db.Column(
        db.Integer, db.ForeignKey("invoices.id"), nullable=False, index=True
    )
    description = db.Column(db.String(500), nullable=False)
    quantity = db.Column(db.Float, default=1)
    unit_price = db.Column(db.Float, default=0)

    @property
    def amount(self):
        return money(Decimal(str(self.quantity or 0)) * Decimal(str(self.unit_price or 0)))
