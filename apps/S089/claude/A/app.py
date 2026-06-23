"""Flask online shop: browse -> cart -> checkout (provider sandbox) -> webhook.

Run with:  python app.py   (serves on port 5089 by default)
"""
import json
from datetime import datetime
from functools import wraps

import requests
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

from config import Config
from models import Order, OrderItem, Product, User, db
from payments import MockProvider, get_provider, verify_signature


def create_app(config_object=Config):
    app = Flask(__name__)
    app.config.from_object(config_object)

    db.init_app(app)

    with app.app_context():
        db.create_all()
        seed_data(app)

    register_routes(app)
    return app


# --------------------------------------------------------------------------- #
# Seed data
# --------------------------------------------------------------------------- #
def seed_data(app):
    """Create an admin user and a handful of products on first run."""
    if User.query.filter_by(email=app.config["ADMIN_EMAIL"]).first() is None:
        admin = User(email=app.config["ADMIN_EMAIL"], is_admin=True)
        admin.set_password(app.config["ADMIN_PASSWORD"])
        db.session.add(admin)

    if Product.query.count() == 0:
        demo = [
            ("Mechanical Keyboard", "Hot-swappable, tactile switches.", 8900, 25,
             "https://placehold.co/400x300?text=Keyboard"),
            ("Wireless Mouse", "Ergonomic, 6 programmable buttons.", 3500, 40,
             "https://placehold.co/400x300?text=Mouse"),
            ("27\" 4K Monitor", "IPS panel, USB-C, 60Hz.", 32900, 12,
             "https://placehold.co/400x300?text=Monitor"),
            ("USB-C Hub", "7-in-1, HDMI + ethernet + card reader.", 4900, 60,
             "https://placehold.co/400x300?text=USB-C+Hub"),
            ("Noise-Cancelling Headphones", "Over-ear, 30h battery.", 19900, 18,
             "https://placehold.co/400x300?text=Headphones"),
            ("Webcam 1080p", "Auto-focus with privacy shutter.", 5900, 33,
             "https://placehold.co/400x300?text=Webcam"),
        ]
        for name, desc, price, stock, img in demo:
            db.session.add(
                Product(name=name, description=desc, price_cents=price,
                        stock=stock, image_url=img)
            )
    db.session.commit()


# --------------------------------------------------------------------------- #
# Auth helpers
# --------------------------------------------------------------------------- #
def current_user():
    uid = session.get("user_id")
    if uid is None:
        return None
    return db.session.get(User, uid)


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            flash("Please log in to continue.", "warning")
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None or not g.user.is_admin:
            abort(403)
        return view(*args, **kwargs)

    return wrapped


# --------------------------------------------------------------------------- #
# Cart helpers (stored in the session as {product_id: qty})
# --------------------------------------------------------------------------- #
def get_cart():
    return session.get("cart", {})


def save_cart(cart):
    session["cart"] = cart
    session.modified = True


def cart_items_and_total(cart):
    """Resolve the session cart into product rows + total cents."""
    items, total = [], 0
    for pid, qty in cart.items():
        product = db.session.get(Product, int(pid))
        if product is None:
            continue
        line_total = product.price_cents * qty
        total += line_total
        items.append({"product": product, "quantity": qty, "line_total": line_total})
    return items, total


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
def register_routes(app):
    @app.before_request
    def load_user():
        g.user = current_user()

    @app.context_processor
    def inject_globals():
        cart = get_cart()
        return {
            "current_user": g.user,
            "cart_count": sum(cart.values()),
        }

    # ----- catalogue ------------------------------------------------------- #
    @app.route("/")
    def index():
        products = Product.query.order_by(Product.name).all()
        return render_template("products.html", products=products)

    @app.route("/product/<int:product_id>")
    def product_detail(product_id):
        product = db.session.get(Product, product_id) or abort(404)
        return render_template("product.html", product=product)

    # ----- cart ------------------------------------------------------------ #
    @app.route("/cart")
    def cart_view():
        items, total = cart_items_and_total(get_cart())
        return render_template("cart.html", items=items, total=total)

    @app.route("/cart/add/<int:product_id>", methods=["POST"])
    def cart_add(product_id):
        product = db.session.get(Product, product_id) or abort(404)
        qty = max(1, int(request.form.get("quantity", 1)))
        cart = get_cart()
        cart[str(product_id)] = min(
            cart.get(str(product_id), 0) + qty, max(product.stock, 1)
        )
        save_cart(cart)
        flash(f"Added {product.name} to your cart.", "success")
        return redirect(request.form.get("next") or url_for("cart_view"))

    @app.route("/cart/update", methods=["POST"])
    def cart_update():
        cart = get_cart()
        for pid in list(cart.keys()):
            qty = int(request.form.get(f"qty_{pid}", cart[pid]))
            if qty <= 0:
                cart.pop(pid, None)
            else:
                cart[pid] = qty
        save_cart(cart)
        flash("Cart updated.", "success")
        return redirect(url_for("cart_view"))

    @app.route("/cart/remove/<int:product_id>", methods=["POST"])
    def cart_remove(product_id):
        cart = get_cart()
        cart.pop(str(product_id), None)
        save_cart(cart)
        return redirect(url_for("cart_view"))

    # ----- checkout -------------------------------------------------------- #
    @app.route("/checkout", methods=["POST"])
    @login_required
    def checkout():
        cart = get_cart()
        items, total = cart_items_and_total(cart)
        if not items:
            flash("Your cart is empty.", "warning")
            return redirect(url_for("cart_view"))

        # Create the order in 'pending' state.
        order = Order(
            user_id=g.user.id,
            status="pending",
            total_cents=total,
            currency=app.config["CURRENCY"],
            provider=app.config["PAYMENT_PROVIDER"],
        )
        db.session.add(order)
        db.session.flush()  # assign order.id

        line_items = []
        for it in items:
            p = it["product"]
            db.session.add(
                OrderItem(
                    order_id=order.id,
                    product_id=p.id,
                    name=p.name,
                    unit_price_cents=p.price_cents,
                    quantity=it["quantity"],
                )
            )
            line_items.append(
                {"name": p.name, "unit_price_cents": p.price_cents,
                 "quantity": it["quantity"]}
            )

        provider = get_provider(app)
        session_id, redirect_url = provider.create_checkout_session(order, line_items)
        order.provider_session_id = session_id
        db.session.commit()

        # Cart is consumed; the pending order now owns the items.
        save_cart({})
        return redirect(redirect_url)

    @app.route("/checkout/success")
    @login_required
    def checkout_success():
        order_id = request.args.get("order_id", type=int)
        order = db.session.get(Order, order_id)
        if order is None or order.user_id != g.user.id:
            abort(404)
        return render_template("checkout_result.html", order=order, success=True)

    @app.route("/checkout/cancel")
    @login_required
    def checkout_cancel():
        order_id = request.args.get("order_id", type=int)
        order = db.session.get(Order, order_id)
        if order and order.user_id == g.user.id and order.status == "pending":
            order.status = "cancelled"
            db.session.commit()
        return render_template("checkout_result.html", order=order, success=False)

    # ----- mock provider hosted payment page ------------------------------- #
    @app.route("/mock/pay/<session_id>")
    @login_required
    def mock_pay(session_id):
        order = Order.query.filter_by(provider_session_id=session_id).first() or abort(404)
        if order.user_id != g.user.id:
            abort(403)
        return render_template("mock_pay.html", order=order)

    @app.route("/mock/pay/<session_id>/confirm", methods=["POST"])
    @login_required
    def mock_pay_confirm(session_id):
        """Simulate the shopper paying on the provider's site.

        We post a *signed* event to our own webhook the same way the provider's
        backend would, then redirect the shopper to the success page.
        """
        order = Order.query.filter_by(provider_session_id=session_id).first() or abort(404)
        if order.user_id != g.user.id:
            abort(403)

        body, header = MockProvider(app).build_event(order)
        try:
            requests.post(
                f"{app.config['BASE_URL']}/webhook",
                data=body,
                headers={"Content-Type": "application/json",
                         "X-Signature": header},
                timeout=5,
            )
        except requests.RequestException:
            # Even if the out-of-band call fails, the success page will reflect
            # whatever state the webhook managed to set.
            flash("Payment processed, but confirmation is delayed.", "warning")
        return redirect(url_for("checkout_success", order_id=order.id))

    @app.route("/mock/pay/<session_id>/cancel", methods=["POST"])
    @login_required
    def mock_pay_cancel(session_id):
        order = Order.query.filter_by(provider_session_id=session_id).first() or abort(404)
        return redirect(url_for("checkout_cancel", order_id=order.id))

    # ----- webhook (provider -> us) ---------------------------------------- #
    @app.route("/webhook", methods=["POST"])
    def webhook():
        payload = request.get_data()
        provider_name = app.config["PAYMENT_PROVIDER"]

        if provider_name == "stripe":
            event = _verify_stripe_event(app, payload, request.headers)
            if event is None:
                abort(400, "Invalid signature")
            session_id = event["data"]["object"]["id"]
        else:
            header = request.headers.get("X-Signature", "")
            if not verify_signature(app.config["WEBHOOK_SECRET"], payload, header):
                abort(400, "Invalid signature")
            event = json.loads(payload)
            session_id = event["data"]["object"]["id"]

        if event.get("type") != "checkout.session.completed":
            return ("", 200)  # ignore unrelated events

        order = Order.query.filter_by(provider_session_id=session_id).first()
        if order is None:
            return ("", 200)  # unknown session; nothing to do

        # Idempotent: a provider may deliver the same event more than once.
        if order.status != "paid":
            order.status = "paid"
            order.paid_at = datetime.utcnow()
            # Decrement stock now that payment is confirmed.
            for item in order.items:
                product = db.session.get(Product, item.product_id)
                if product:
                    product.stock = max(0, product.stock - item.quantity)
            db.session.commit()
        return ("", 200)

    # ----- order history --------------------------------------------------- #
    @app.route("/orders")
    @login_required
    def orders():
        rows = (
            Order.query.filter_by(user_id=g.user.id)
            .order_by(Order.created_at.desc())
            .all()
        )
        return render_template("orders.html", orders=rows)

    @app.route("/orders/<int:order_id>")
    @login_required
    def order_detail(order_id):
        order = db.session.get(Order, order_id) or abort(404)
        if order.user_id != g.user.id and not g.user.is_admin:
            abort(403)
        return render_template("order_detail.html", order=order)

    # ----- admin ----------------------------------------------------------- #
    @app.route("/admin/orders")
    @admin_required
    def admin_orders():
        status = request.args.get("status")
        query = Order.query
        if status in {"pending", "paid", "cancelled"}:
            query = query.filter_by(status=status)
        rows = query.order_by(Order.created_at.desc()).all()
        return render_template("admin_orders.html", orders=rows, status=status)

    # ----- auth ------------------------------------------------------------ #
    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            email = request.form.get("email", "").strip().lower()
            password = request.form.get("password", "")
            if not email or not password:
                flash("Email and password are required.", "danger")
            elif User.query.filter_by(email=email).first():
                flash("That email is already registered.", "danger")
            else:
                user = User(email=email)
                user.set_password(password)
                db.session.add(user)
                db.session.commit()
                session["user_id"] = user.id
                flash("Welcome! Your account was created.", "success")
                return redirect(url_for("index"))
        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            email = request.form.get("email", "").strip().lower()
            password = request.form.get("password", "")
            user = User.query.filter_by(email=email).first()
            if user and user.check_password(password):
                session["user_id"] = user.id
                flash("Logged in.", "success")
                return redirect(request.args.get("next") or url_for("index"))
            flash("Invalid email or password.", "danger")
        return render_template("login.html")

    @app.route("/logout")
    def logout():
        session.pop("user_id", None)
        flash("Logged out.", "success")
        return redirect(url_for("index"))

    # ----- error pages ----------------------------------------------------- #
    @app.errorhandler(403)
    def forbidden(_):
        return render_template("error.html", code=403,
                               message="You don't have access to that."), 403

    @app.errorhandler(404)
    def not_found(_):
        return render_template("error.html", code=404,
                               message="Page not found."), 404


def _verify_stripe_event(app, payload, headers):
    """Verify a real Stripe webhook signature; returns the event dict or None."""
    import stripe

    sig = headers.get("Stripe-Signature", "")
    try:
        return stripe.Webhook.construct_event(
            payload, sig, app.config["WEBHOOK_SECRET"]
        )
    except Exception:
        return None


app = create_app()


if __name__ == "__main__":
    # threaded=True so the mock provider's server-side call to our own /webhook
    # (made while still handling the "Pay" request) is served concurrently.
    app.run(host="0.0.0.0", port=app.config["SERVER_PORT"], debug=True, threaded=True)
