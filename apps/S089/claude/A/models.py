"""Database models. Money is always stored as integer cents to avoid floats."""
from datetime import datetime

from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import check_password_hash, generate_password_hash

db = SQLAlchemy()


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    is_admin = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    orders = db.relationship("Order", backref="user", lazy="dynamic")

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Product(db.Model):
    __tablename__ = "products"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, default="")
    price_cents = db.Column(db.Integer, nullable=False)
    stock = db.Column(db.Integer, default=0, nullable=False)
    image_url = db.Column(db.String(512), default="")

    @property
    def price_display(self):
        return f"${self.price_cents / 100:.2f}"


class Order(db.Model):
    __tablename__ = "orders"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    # pending -> paid | cancelled
    status = db.Column(db.String(20), default="pending", nullable=False, index=True)
    total_cents = db.Column(db.Integer, nullable=False, default=0)
    currency = db.Column(db.String(10), default="usd", nullable=False)

    # The payment provider's checkout/session identifier. Used to correlate a
    # webhook event back to the order it belongs to.
    provider_session_id = db.Column(db.String(255), unique=True, index=True)
    provider = db.Column(db.String(20), default="mock", nullable=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False, index=True)
    paid_at = db.Column(db.DateTime, nullable=True)

    items = db.relationship(
        "OrderItem", backref="order", lazy="select", cascade="all, delete-orphan"
    )

    @property
    def total_display(self):
        return f"${self.total_cents / 100:.2f}"


class OrderItem(db.Model):
    __tablename__ = "order_items"

    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.Integer, db.ForeignKey("orders.id"), nullable=False)
    product_id = db.Column(db.Integer, db.ForeignKey("products.id"), nullable=False)

    # Snapshot the name/price at purchase time so order history is stable even
    # if the product is later renamed or repriced.
    name = db.Column(db.String(255), nullable=False)
    unit_price_cents = db.Column(db.Integer, nullable=False)
    quantity = db.Column(db.Integer, nullable=False, default=1)

    @property
    def line_total_cents(self):
        return self.unit_price_cents * self.quantity

    @property
    def line_total_display(self):
        return f"${self.line_total_cents / 100:.2f}"

    @property
    def unit_price_display(self):
        return f"${self.unit_price_cents / 100:.2f}"
