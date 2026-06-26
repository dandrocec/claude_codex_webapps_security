import os
from datetime import datetime, timezone
from decimal import Decimal

import stripe
from flask import (
    Flask,
    abort,
    flash,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import event
from sqlalchemy.engine import Engine
from werkzeug.security import check_password_hash, generate_password_hash


BASE_DIR = os.path.abspath(os.path.dirname(__file__))

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("FLASK_SECRET_KEY", "dev-only-secret-key")
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + os.path.join(BASE_DIR, "shop.sqlite3")
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["STRIPE_SECRET_KEY"] = os.environ.get("STRIPE_SECRET_KEY", "")
app.config["STRIPE_PUBLISHABLE_KEY"] = os.environ.get("STRIPE_PUBLISHABLE_KEY", "")
app.config["STRIPE_WEBHOOK_SECRET"] = os.environ.get("STRIPE_WEBHOOK_SECRET", "")

stripe.api_key = app.config["STRIPE_SECRET_KEY"]
db = SQLAlchemy(app)


@event.listens_for(Engine, "connect")
def enable_sqlite_foreign_keys(dbapi_connection, _connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    is_admin = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    orders = db.relationship("Order", back_populates="user", cascade="all, delete-orphan")

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Product(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(160), nullable=False)
    description = db.Column(db.Text, nullable=False)
    price_cents = db.Column(db.Integer, nullable=False)
    image_url = db.Column(db.String(500), nullable=False)
    active = db.Column(db.Boolean, default=True, nullable=False)

    @property
    def price(self):
        return Decimal(self.price_cents) / Decimal("100")


class Order(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    status = db.Column(db.String(40), default="pending", nullable=False, index=True)
    total_cents = db.Column(db.Integer, nullable=False)
    stripe_session_id = db.Column(db.String(255), unique=True, nullable=True, index=True)
    stripe_payment_intent = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    paid_at = db.Column(db.DateTime, nullable=True)

    user = db.relationship("User", back_populates="orders")
    items = db.relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")

    @property
    def total(self):
        return Decimal(self.total_cents) / Decimal("100")


class OrderItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.Integer, db.ForeignKey("order.id"), nullable=False, index=True)
    product_id = db.Column(db.Integer, db.ForeignKey("product.id"), nullable=True)
    product_name = db.Column(db.String(160), nullable=False)
    unit_price_cents = db.Column(db.Integer, nullable=False)
    quantity = db.Column(db.Integer, nullable=False)

    order = db.relationship("Order", back_populates="items")
    product = db.relationship("Product")

    @property
    def line_total(self):
        return Decimal(self.unit_price_cents * self.quantity) / Decimal("100")


def money(cents):
    return f"${Decimal(cents) / Decimal('100'):.2f}"


app.jinja_env.filters["money"] = money


def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    return db.session.get(User, user_id)


@app.context_processor
def inject_globals():
    return {
        "current_user": current_user(),
        "cart_count": sum(session.get("cart", {}).values()),
        "stripe_publishable_key": app.config["STRIPE_PUBLISHABLE_KEY"],
    }


def login_required(view):
    def wrapped(*args, **kwargs):
        if not current_user():
            flash("Please sign in first.", "warning")
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    wrapped.__name__ = view.__name__
    return wrapped


def admin_required(view):
    def wrapped(*args, **kwargs):
        user = current_user()
        if not user or not user.is_admin:
            abort(403)
        return view(*args, **kwargs)

    wrapped.__name__ = view.__name__
    return wrapped


def get_cart():
    cart = session.setdefault("cart", {})
    cleaned = {}
    for key, value in cart.items():
        try:
            product_id = str(int(key))
            quantity = max(1, int(value))
            cleaned[product_id] = quantity
        except (TypeError, ValueError):
            continue
    session["cart"] = cleaned
    return cleaned


def cart_rows():
    cart = get_cart()
    if not cart:
        return [], 0
    products = Product.query.filter(Product.id.in_([int(pid) for pid in cart.keys()]), Product.active.is_(True)).all()
    rows = []
    total_cents = 0
    for product in products:
        quantity = cart.get(str(product.id), 0)
        line_cents = product.price_cents * quantity
        total_cents += line_cents
        rows.append({"product": product, "quantity": quantity, "line_cents": line_cents})
    return rows, total_cents


def create_order(user, rows, total_cents):
    order = Order(user=user, total_cents=total_cents, status="pending")
    for row in rows:
        product = row["product"]
        order.items.append(
            OrderItem(
                product=product,
                product_name=product.name,
                unit_price_cents=product.price_cents,
                quantity=row["quantity"],
            )
        )
    db.session.add(order)
    db.session.commit()
    return order


def mark_order_paid(order, payment_intent=None):
    if order.status != "paid":
        order.status = "paid"
        order.paid_at = datetime.now(timezone.utc)
    if payment_intent:
        order.stripe_payment_intent = payment_intent
    db.session.commit()


@app.route("/")
def products():
    products_list = Product.query.filter_by(active=True).order_by(Product.name).all()
    return render_template("products.html", products=products_list)


@app.post("/cart/add/<int:product_id>")
def add_to_cart(product_id):
    product = db.session.get(Product, product_id)
    if not product or not product.active:
        abort(404)
    quantity = max(1, int(request.form.get("quantity", 1)))
    cart = get_cart()
    cart[str(product_id)] = cart.get(str(product_id), 0) + quantity
    session["cart"] = cart
    session.modified = True
    flash(f"Added {product.name} to your cart.", "success")
    return redirect(url_for("products"))


@app.route("/cart")
def cart():
    rows, total_cents = cart_rows()
    return render_template("cart.html", rows=rows, total_cents=total_cents)


@app.post("/cart/update/<int:product_id>")
def update_cart(product_id):
    quantity = int(request.form.get("quantity", 1))
    cart = get_cart()
    if quantity <= 0:
        cart.pop(str(product_id), None)
    else:
        cart[str(product_id)] = quantity
    session["cart"] = cart
    session.modified = True
    return redirect(url_for("cart"))


@app.post("/checkout")
@login_required
def checkout():
    user = current_user()
    rows, total_cents = cart_rows()
    if not rows:
        flash("Your cart is empty.", "warning")
        return redirect(url_for("cart"))

    order = create_order(user, rows, total_cents)
    session["cart"] = {}
    session.modified = True

    if not app.config["STRIPE_SECRET_KEY"]:
        flash("Stripe is not configured. Your pending order was created locally.", "warning")
        return redirect(url_for("order_detail", order_id=order.id))

    checkout_session = stripe.checkout.Session.create(
        mode="payment",
        customer_email=user.email,
        line_items=[
            {
                "price_data": {
                    "currency": "usd",
                    "product_data": {"name": item.product_name},
                    "unit_amount": item.unit_price_cents,
                },
                "quantity": item.quantity,
            }
            for item in order.items
        ],
        metadata={"order_id": str(order.id)},
        success_url=url_for("checkout_success", order_id=order.id, _external=True)
        + "?session_id={CHECKOUT_SESSION_ID}",
        cancel_url=url_for("order_detail", order_id=order.id, _external=True),
    )
    order.stripe_session_id = checkout_session.id
    db.session.commit()
    return redirect(checkout_session.url, code=303)


@app.route("/checkout/success/<int:order_id>")
@login_required
def checkout_success(order_id):
    order = Order.query.filter_by(id=order_id, user_id=current_user().id).first_or_404()
    flash("Checkout completed. Your order will show as paid after the webhook is received.", "info")
    return redirect(url_for("order_detail", order_id=order.id))


@app.post("/webhook/stripe")
def stripe_webhook():
    payload = request.get_data()
    signature = request.headers.get("Stripe-Signature")
    webhook_secret = app.config["STRIPE_WEBHOOK_SECRET"]

    try:
        if webhook_secret:
            event = stripe.Webhook.construct_event(payload, signature, webhook_secret)
        else:
            event = stripe.Event.construct_from(request.get_json(force=True), stripe.api_key)
    except Exception:
        return "Invalid webhook", 400

    if event["type"] == "checkout.session.completed":
        session_obj = event["data"]["object"]
        order_id = session_obj.get("metadata", {}).get("order_id")
        order = db.session.get(Order, int(order_id)) if order_id else None
        if order:
            order.stripe_session_id = session_obj.get("id")
            mark_order_paid(order, session_obj.get("payment_intent"))

    return "ok", 200


@app.route("/orders")
@login_required
def orders():
    user_orders = (
        Order.query.filter_by(user_id=current_user().id)
        .order_by(Order.created_at.desc())
        .all()
    )
    return render_template("orders.html", orders=user_orders)


@app.route("/orders/<int:order_id>")
@login_required
def order_detail(order_id):
    order = Order.query.filter_by(id=order_id, user_id=current_user().id).first_or_404()
    return render_template("order_detail.html", order=order)


@app.route("/admin/orders")
@admin_required
def admin_orders():
    all_orders = Order.query.order_by(Order.created_at.desc()).all()
    return render_template("admin_orders.html", orders=all_orders)


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        email = request.form["email"].strip().lower()
        password = request.form["password"]
        if len(password) < 6:
            flash("Password must be at least 6 characters.", "warning")
            return render_template("register.html")
        if User.query.filter_by(email=email).first():
            flash("That email is already registered.", "warning")
            return render_template("register.html")
        user = User(email=email, password_hash=generate_password_hash(password))
        db.session.add(user)
        db.session.commit()
        session["user_id"] = user.id
        flash("Account created.", "success")
        return redirect(url_for("products"))
    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        email = request.form["email"].strip().lower()
        password = request.form["password"]
        user = User.query.filter_by(email=email).first()
        if not user or not user.check_password(password):
            flash("Invalid email or password.", "danger")
            return render_template("login.html")
        session["user_id"] = user.id
        flash("Signed in.", "success")
        return redirect(request.args.get("next") or url_for("products"))
    return render_template("login.html")


@app.post("/logout")
def logout():
    session.clear()
    flash("Signed out.", "info")
    return redirect(url_for("products"))


def seed_data():
    db.create_all()
    if not User.query.filter_by(email="admin@example.com").first():
        db.session.add(
            User(
                email="admin@example.com",
                password_hash=generate_password_hash("admin123"),
                is_admin=True,
            )
        )
    if Product.query.count() == 0:
        db.session.add_all(
            [
                Product(
                    name="Canvas Day Tote",
                    description="A structured cotton tote with reinforced handles and an interior pocket.",
                    price_cents=3200,
                    image_url="https://images.unsplash.com/photo-1594223274512-ad4803739b7c?auto=format&fit=crop&w=900&q=80",
                ),
                Product(
                    name="Desk Lamp",
                    description="Adjustable warm LED lamp with a powder-coated steel body.",
                    price_cents=6800,
                    image_url="https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=80",
                ),
                Product(
                    name="Ceramic Mug Set",
                    description="Two hand-glazed stoneware mugs for coffee, tea, or cocoa.",
                    price_cents=2800,
                    image_url="https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=900&q=80",
                ),
                Product(
                    name="Notebook Pack",
                    description="Three lay-flat notebooks with dotted pages and recycled paper covers.",
                    price_cents=1800,
                    image_url="https://images.unsplash.com/photo-1531346680769-a1d79b57de5c?auto=format&fit=crop&w=900&q=80",
                ),
            ]
        )
    db.session.commit()


with app.app_context():
    seed_data()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5089, debug=True)
