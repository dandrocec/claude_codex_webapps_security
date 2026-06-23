from datetime import datetime

from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import check_password_hash, generate_password_hash

db = SQLAlchemy()


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    name = db.Column(db.String(120), nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    is_admin = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    cart_items = db.relationship(
        "CartItem", backref="user", cascade="all, delete-orphan"
    )
    orders = db.relationship("Order", backref="user")
    reviews = db.relationship("Review", backref="user")

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Product(db.Model):
    __tablename__ = "products"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, default="")
    # All money stored as integer cents to avoid float rounding errors.
    price_cents = db.Column(db.Integer, nullable=False)
    stock = db.Column(db.Integer, default=0, nullable=False)
    category = db.Column(db.String(80), default="General")
    image_url = db.Column(db.String(500), default="")
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    reviews = db.relationship(
        "Review", backref="product", cascade="all, delete-orphan"
    )

    @property
    def price(self):
        return self.price_cents / 100.0

    @property
    def avg_rating(self):
        if not self.reviews:
            return None
        return round(sum(r.rating for r in self.reviews) / len(self.reviews), 1)

    @property
    def in_stock(self):
        return self.stock > 0


class CartItem(db.Model):
    __tablename__ = "cart_items"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    product_id = db.Column(
        db.Integer, db.ForeignKey("products.id"), nullable=False
    )
    quantity = db.Column(db.Integer, default=1, nullable=False)

    product = db.relationship("Product")

    __table_args__ = (
        db.UniqueConstraint("user_id", "product_id", name="uq_cart_user_product"),
    )

    @property
    def line_total_cents(self):
        return self.product.price_cents * self.quantity


class Order(db.Model):
    __tablename__ = "orders"

    STATUSES = ["pending", "paid", "shipped", "delivered", "cancelled"]

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    status = db.Column(db.String(20), default="pending", nullable=False)
    # Authoritative total, computed server-side at checkout.
    total_cents = db.Column(db.Integer, nullable=False)
    shipping_name = db.Column(db.String(120), nullable=False)
    shipping_address = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    items = db.relationship(
        "OrderItem", backref="order", cascade="all, delete-orphan"
    )

    @property
    def total(self):
        return self.total_cents / 100.0


class OrderItem(db.Model):
    __tablename__ = "order_items"

    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.Integer, db.ForeignKey("orders.id"), nullable=False)
    product_id = db.Column(
        db.Integer, db.ForeignKey("products.id"), nullable=False
    )
    product_name = db.Column(db.String(200), nullable=False)  # snapshot
    unit_price_cents = db.Column(db.Integer, nullable=False)  # snapshot
    quantity = db.Column(db.Integer, nullable=False)

    product = db.relationship("Product")

    @property
    def line_total_cents(self):
        return self.unit_price_cents * self.quantity


class Review(db.Model):
    __tablename__ = "reviews"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    product_id = db.Column(
        db.Integer, db.ForeignKey("products.id"), nullable=False
    )
    rating = db.Column(db.Integer, nullable=False)  # 1-5
    comment = db.Column(db.Text, default="")
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        db.UniqueConstraint("user_id", "product_id", name="uq_review_user_product"),
    )
