from functools import wraps

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

from config import Config
from models import (
    CartItem,
    Order,
    OrderItem,
    Product,
    Review,
    User,
    db,
)


def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)

    db.init_app(app)

    with app.app_context():
        db.create_all()

    register_template_helpers(app)
    register_context(app)
    register_storefront_routes(app)
    register_auth_routes(app)
    register_admin_routes(app)

    return app


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def current_user():
    uid = session.get("user_id")
    if uid is None:
        return None
    return db.session.get(User, uid)


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if current_user() is None:
            flash("Please log in to continue.", "warning")
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = current_user()
        if user is None:
            flash("Please log in to continue.", "warning")
            return redirect(url_for("login", next=request.path))
        if not user.is_admin:
            abort(403)
        return view(*args, **kwargs)

    return wrapped


def cart_for(user):
    """Return cart items and the server-computed total in cents."""
    items = (
        CartItem.query.filter_by(user_id=user.id)
        .join(Product)
        .order_by(CartItem.id)
        .all()
    )
    total_cents = sum(item.line_total_cents for item in items)
    return items, total_cents


def register_template_helpers(app):
    @app.template_filter("money")
    def money(cents):
        try:
            return "${:,.2f}".format((cents or 0) / 100.0)
        except (TypeError, ValueError):
            return "$0.00"


def register_context(app):
    @app.context_processor
    def inject_globals():
        user = current_user()
        cart_count = 0
        if user and not user.is_admin:
            cart_count = sum(
                ci.quantity for ci in CartItem.query.filter_by(user_id=user.id)
            )
        return {"current_user": user, "cart_count": cart_count}


# --------------------------------------------------------------------------- #
# Storefront
# --------------------------------------------------------------------------- #
def register_storefront_routes(app):
    @app.route("/")
    def index():
        q = request.args.get("q", "").strip()
        category = request.args.get("category", "").strip()
        query = Product.query.filter_by(is_active=True)
        if q:
            query = query.filter(Product.name.ilike(f"%{q}%"))
        if category:
            query = query.filter_by(category=category)
        products = query.order_by(Product.name).all()
        categories = [
            c[0]
            for c in db.session.query(Product.category)
            .filter_by(is_active=True)
            .distinct()
            .order_by(Product.category)
        ]
        return render_template(
            "index.html",
            products=products,
            categories=categories,
            q=q,
            active_category=category,
        )

    @app.route("/product/<int:product_id>")
    def product_detail(product_id):
        product = Product.query.filter_by(
            id=product_id, is_active=True
        ).first_or_404()
        reviews = (
            Review.query.filter_by(product_id=product_id)
            .order_by(Review.created_at.desc())
            .all()
        )
        user = current_user()
        can_review = False
        already_reviewed = False
        if user and not user.is_admin:
            already_reviewed = (
                Review.query.filter_by(
                    user_id=user.id, product_id=product_id
                ).first()
                is not None
            )
            # Only customers who purchased a (paid+) order containing the
            # product may review it.
            can_review = not already_reviewed and _has_purchased(
                user.id, product_id
            )
        return render_template(
            "product_detail.html",
            product=product,
            reviews=reviews,
            can_review=can_review,
            already_reviewed=already_reviewed,
        )

    @app.route("/product/<int:product_id>/review", methods=["POST"])
    @login_required
    def add_review(product_id):
        user = current_user()
        if user.is_admin:
            abort(403)
        product = Product.query.filter_by(
            id=product_id, is_active=True
        ).first_or_404()

        if not _has_purchased(user.id, product_id):
            flash("You can only review products you have purchased.", "danger")
            return redirect(url_for("product_detail", product_id=product_id))

        if Review.query.filter_by(
            user_id=user.id, product_id=product_id
        ).first():
            flash("You have already reviewed this product.", "warning")
            return redirect(url_for("product_detail", product_id=product_id))

        try:
            rating = int(request.form.get("rating", 0))
        except ValueError:
            rating = 0
        if rating < 1 or rating > 5:
            flash("Rating must be between 1 and 5.", "danger")
            return redirect(url_for("product_detail", product_id=product_id))

        review = Review(
            user_id=user.id,
            product_id=product.id,
            rating=rating,
            comment=request.form.get("comment", "").strip(),
        )
        db.session.add(review)
        db.session.commit()
        flash("Thanks for your review!", "success")
        return redirect(url_for("product_detail", product_id=product_id))

    # ---- Cart -------------------------------------------------------------- #
    @app.route("/cart")
    @login_required
    def cart():
        user = current_user()
        if user.is_admin:
            abort(403)
        items, total_cents = cart_for(user)
        return render_template(
            "cart.html", items=items, total_cents=total_cents
        )

    @app.route("/cart/add/<int:product_id>", methods=["POST"])
    @login_required
    def cart_add(product_id):
        user = current_user()
        if user.is_admin:
            abort(403)
        product = Product.query.filter_by(
            id=product_id, is_active=True
        ).first_or_404()

        try:
            qty = int(request.form.get("quantity", 1))
        except ValueError:
            qty = 1
        qty = max(1, qty)

        item = CartItem.query.filter_by(
            user_id=user.id, product_id=product.id
        ).first()
        current_qty = item.quantity if item else 0
        if current_qty + qty > product.stock:
            flash(
                f"Only {product.stock} unit(s) of '{product.name}' available.",
                "warning",
            )
            qty = product.stock - current_qty
            if qty <= 0:
                return redirect(request.referrer or url_for("index"))

        if item:
            item.quantity += qty
        else:
            item = CartItem(
                user_id=user.id, product_id=product.id, quantity=qty
            )
            db.session.add(item)
        db.session.commit()
        flash(f"Added '{product.name}' to your cart.", "success")
        return redirect(request.referrer or url_for("cart"))

    @app.route("/cart/update/<int:item_id>", methods=["POST"])
    @login_required
    def cart_update(item_id):
        user = current_user()
        item = CartItem.query.filter_by(id=item_id, user_id=user.id).first_or_404()
        try:
            qty = int(request.form.get("quantity", 1))
        except ValueError:
            qty = 1
        if qty <= 0:
            db.session.delete(item)
            db.session.commit()
            flash("Item removed from cart.", "info")
            return redirect(url_for("cart"))
        if qty > item.product.stock:
            flash(
                f"Only {item.product.stock} unit(s) available.", "warning"
            )
            qty = item.product.stock
        item.quantity = qty
        db.session.commit()
        return redirect(url_for("cart"))

    @app.route("/cart/remove/<int:item_id>", methods=["POST"])
    @login_required
    def cart_remove(item_id):
        user = current_user()
        item = CartItem.query.filter_by(id=item_id, user_id=user.id).first_or_404()
        db.session.delete(item)
        db.session.commit()
        flash("Item removed from cart.", "info")
        return redirect(url_for("cart"))

    # ---- Checkout ---------------------------------------------------------- #
    @app.route("/checkout", methods=["GET", "POST"])
    @login_required
    def checkout():
        user = current_user()
        if user.is_admin:
            abort(403)
        items, total_cents = cart_for(user)

        if not items:
            flash("Your cart is empty.", "info")
            return redirect(url_for("cart"))

        if request.method == "POST":
            name = request.form.get("shipping_name", "").strip()
            address = request.form.get("shipping_address", "").strip()
            if not name or not address:
                flash("Shipping name and address are required.", "danger")
                return render_template(
                    "checkout.html", items=items, total_cents=total_cents
                )

            # Re-validate stock and recompute the total server-side from
            # authoritative product prices before committing the order.
            for item in items:
                if item.quantity > item.product.stock:
                    flash(
                        f"'{item.product.name}' only has {item.product.stock} "
                        "in stock. Please update your cart.",
                        "danger",
                    )
                    return redirect(url_for("cart"))

            authoritative_total = sum(
                item.product.price_cents * item.quantity for item in items
            )

            order = Order(
                user_id=user.id,
                status="paid",
                total_cents=authoritative_total,
                shipping_name=name,
                shipping_address=address,
            )
            db.session.add(order)
            db.session.flush()  # assign order.id

            for item in items:
                db.session.add(
                    OrderItem(
                        order_id=order.id,
                        product_id=item.product_id,
                        product_name=item.product.name,
                        unit_price_cents=item.product.price_cents,
                        quantity=item.quantity,
                    )
                )
                item.product.stock -= item.quantity  # decrement inventory
                db.session.delete(item)  # clear cart

            db.session.commit()
            flash(
                f"Order #{order.id} placed successfully! "
                f"Total: ${order.total:,.2f}",
                "success",
            )
            return redirect(url_for("order_detail", order_id=order.id))

        return render_template(
            "checkout.html", items=items, total_cents=total_cents
        )

    # ---- Orders (customer) ------------------------------------------------- #
    @app.route("/orders")
    @login_required
    def orders():
        user = current_user()
        if user.is_admin:
            return redirect(url_for("admin_orders"))
        my_orders = (
            Order.query.filter_by(user_id=user.id)
            .order_by(Order.created_at.desc())
            .all()
        )
        return render_template("orders.html", orders=my_orders)

    @app.route("/orders/<int:order_id>")
    @login_required
    def order_detail(order_id):
        user = current_user()
        order = Order.query.get_or_404(order_id)
        if order.user_id != user.id and not user.is_admin:
            abort(403)
        return render_template("order_detail.html", order=order)


def _has_purchased(user_id, product_id):
    return (
        db.session.query(OrderItem.id)
        .join(Order)
        .filter(
            Order.user_id == user_id,
            OrderItem.product_id == product_id,
            Order.status != "cancelled",
        )
        .first()
        is not None
    )


# --------------------------------------------------------------------------- #
# Authentication
# --------------------------------------------------------------------------- #
def register_auth_routes(app):
    @app.route("/register", methods=["GET", "POST"])
    def register():
        if current_user():
            return redirect(url_for("index"))
        if request.method == "POST":
            name = request.form.get("name", "").strip()
            email = request.form.get("email", "").strip().lower()
            password = request.form.get("password", "")
            if not name or not email or not password:
                flash("All fields are required.", "danger")
                return render_template("register.html")
            if len(password) < 6:
                flash("Password must be at least 6 characters.", "danger")
                return render_template("register.html")
            if User.query.filter_by(email=email).first():
                flash("An account with that email already exists.", "danger")
                return render_template("register.html")

            user = User(name=name, email=email)
            user.set_password(password)
            db.session.add(user)
            db.session.commit()
            session["user_id"] = user.id
            flash("Welcome! Your account has been created.", "success")
            return redirect(url_for("index"))
        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if current_user():
            return redirect(url_for("index"))
        if request.method == "POST":
            email = request.form.get("email", "").strip().lower()
            password = request.form.get("password", "")
            user = User.query.filter_by(email=email).first()
            if user is None or not user.check_password(password):
                flash("Invalid email or password.", "danger")
                return render_template("login.html")
            session["user_id"] = user.id
            flash(f"Welcome back, {user.name}!", "success")
            next_url = request.args.get("next") or request.form.get("next")
            if user.is_admin and not next_url:
                return redirect(url_for("admin_dashboard"))
            return redirect(next_url or url_for("index"))
        return render_template("login.html")

    @app.route("/logout", methods=["POST"])
    def logout():
        session.clear()
        flash("You have been logged out.", "info")
        return redirect(url_for("index"))


# --------------------------------------------------------------------------- #
# Admin back office
# --------------------------------------------------------------------------- #
def register_admin_routes(app):
    @app.route("/admin")
    @admin_required
    def admin_dashboard():
        stats = {
            "products": Product.query.count(),
            "active_products": Product.query.filter_by(is_active=True).count(),
            "orders": Order.query.count(),
            "customers": User.query.filter_by(is_admin=False).count(),
            "low_stock": Product.query.filter(Product.stock <= 5).count(),
            "revenue_cents": db.session.query(
                db.func.coalesce(db.func.sum(Order.total_cents), 0)
            )
            .filter(Order.status != "cancelled")
            .scalar(),
        }
        recent_orders = (
            Order.query.order_by(Order.created_at.desc()).limit(10).all()
        )
        low_stock = (
            Product.query.filter(Product.stock <= 5)
            .order_by(Product.stock)
            .limit(10)
            .all()
        )
        return render_template(
            "admin/dashboard.html",
            stats=stats,
            recent_orders=recent_orders,
            low_stock=low_stock,
        )

    @app.route("/admin/products")
    @admin_required
    def admin_products():
        products = Product.query.order_by(Product.created_at.desc()).all()
        return render_template("admin/products.html", products=products)

    @app.route("/admin/products/new", methods=["GET", "POST"])
    @admin_required
    def admin_product_new():
        if request.method == "POST":
            error = _save_product_from_form(None)
            if error:
                flash(error, "danger")
                return render_template(
                    "admin/product_form.html", product=None, form=request.form
                )
            flash("Product created.", "success")
            return redirect(url_for("admin_products"))
        return render_template(
            "admin/product_form.html", product=None, form={}
        )

    @app.route("/admin/products/<int:product_id>/edit", methods=["GET", "POST"])
    @admin_required
    def admin_product_edit(product_id):
        product = Product.query.get_or_404(product_id)
        if request.method == "POST":
            error = _save_product_from_form(product)
            if error:
                flash(error, "danger")
                return render_template(
                    "admin/product_form.html",
                    product=product,
                    form=request.form,
                )
            flash("Product updated.", "success")
            return redirect(url_for("admin_products"))
        return render_template(
            "admin/product_form.html", product=product, form={}
        )

    @app.route("/admin/products/<int:product_id>/delete", methods=["POST"])
    @admin_required
    def admin_product_delete(product_id):
        product = Product.query.get_or_404(product_id)
        # Soft-deactivate if the product appears on past orders, to preserve
        # order history; hard-delete only if it was never sold.
        sold = OrderItem.query.filter_by(product_id=product.id).first()
        if sold:
            product.is_active = False
            db.session.commit()
            flash(
                "Product had existing orders; it was deactivated instead of "
                "deleted.",
                "info",
            )
        else:
            db.session.delete(product)
            db.session.commit()
            flash("Product deleted.", "success")
        return redirect(url_for("admin_products"))

    @app.route("/admin/inventory", methods=["GET", "POST"])
    @admin_required
    def admin_inventory():
        if request.method == "POST":
            product = Product.query.get_or_404(
                int(request.form.get("product_id"))
            )
            try:
                new_stock = int(request.form.get("stock"))
            except (TypeError, ValueError):
                flash("Invalid stock value.", "danger")
                return redirect(url_for("admin_inventory"))
            if new_stock < 0:
                flash("Stock cannot be negative.", "danger")
                return redirect(url_for("admin_inventory"))
            product.stock = new_stock
            db.session.commit()
            flash(f"Stock for '{product.name}' set to {new_stock}.", "success")
            return redirect(url_for("admin_inventory"))

        products = Product.query.order_by(Product.name).all()
        return render_template("admin/inventory.html", products=products)

    @app.route("/admin/orders")
    @admin_required
    def admin_orders():
        status = request.args.get("status", "").strip()
        query = Order.query
        if status:
            query = query.filter_by(status=status)
        all_orders = query.order_by(Order.created_at.desc()).all()
        return render_template(
            "admin/orders.html",
            orders=all_orders,
            statuses=Order.STATUSES,
            active_status=status,
        )

    @app.route("/admin/orders/<int:order_id>")
    @admin_required
    def admin_order_detail(order_id):
        order = Order.query.get_or_404(order_id)
        return render_template(
            "admin/order_detail.html", order=order, statuses=Order.STATUSES
        )

    @app.route("/admin/orders/<int:order_id>/status", methods=["POST"])
    @admin_required
    def admin_order_status(order_id):
        order = Order.query.get_or_404(order_id)
        new_status = request.form.get("status", "")
        if new_status not in Order.STATUSES:
            flash("Invalid status.", "danger")
            return redirect(url_for("admin_order_detail", order_id=order.id))

        # Restock items when an order is cancelled (and wasn't already).
        if new_status == "cancelled" and order.status != "cancelled":
            for item in order.items:
                if item.product:
                    item.product.stock += item.quantity

        order.status = new_status
        db.session.commit()
        flash(f"Order #{order.id} marked as {new_status}.", "success")
        return redirect(url_for("admin_order_detail", order_id=order.id))


def _save_product_from_form(product):
    """Create or update a product from request.form. Returns error string or None."""
    name = request.form.get("name", "").strip()
    if not name:
        return "Product name is required."
    try:
        price = float(request.form.get("price", ""))
    except ValueError:
        return "Price must be a number."
    if price < 0:
        return "Price cannot be negative."
    try:
        stock = int(request.form.get("stock", 0))
    except ValueError:
        return "Stock must be a whole number."
    if stock < 0:
        return "Stock cannot be negative."

    if product is None:
        product = Product()
        db.session.add(product)

    product.name = name
    product.description = request.form.get("description", "").strip()
    product.price_cents = round(price * 100)
    product.stock = stock
    product.category = request.form.get("category", "").strip() or "General"
    product.image_url = request.form.get("image_url", "").strip()
    product.is_active = request.form.get("is_active") == "on"
    db.session.commit()
    return None


app = create_app()


@app.errorhandler(403)
def forbidden(_):
    return render_template("error.html", code=403, message="Forbidden"), 403


@app.errorhandler(404)
def not_found(_):
    return render_template("error.html", code=404, message="Page not found"), 404


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5097, debug=True)
