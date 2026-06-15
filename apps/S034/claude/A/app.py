"""Reading-list app: track books, status and ratings per user."""
import os

from flask import (
    Flask, render_template, request, redirect, url_for, flash, abort
)
from flask_login import (
    LoginManager, UserMixin, login_user, logout_user,
    login_required, current_user
)
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash

BASE_DIR = os.path.abspath(os.path.dirname(__file__))

STATUSES = ("to-read", "reading", "finished")

db = SQLAlchemy()


def create_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")
    app.config["SQLALCHEMY_DATABASE_URI"] = (
        "sqlite:///" + os.path.join(BASE_DIR, "reading_list.db")
    )
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    db.init_app(app)

    login_manager = LoginManager()
    login_manager.login_view = "login"
    login_manager.init_app(app)

    @login_manager.user_loader
    def load_user(user_id):
        return db.session.get(User, int(user_id))

    register_routes(app)

    with app.app_context():
        db.create_all()

    return app


class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    books = db.relationship(
        "Book", backref="owner", cascade="all, delete-orphan", lazy=True
    )

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Book(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    author = db.Column(db.String(200), nullable=False)
    status = db.Column(db.String(20), nullable=False, default="to-read")
    rating = db.Column(db.Integer)  # 1-5, optional
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)


def register_routes(app):
    @app.route("/")
    def index():
        if current_user.is_authenticated:
            return redirect(url_for("books"))
        return redirect(url_for("login"))

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if current_user.is_authenticated:
            return redirect(url_for("books"))
        if request.method == "POST":
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")
            if not username or not password:
                flash("Username and password are required.", "error")
            elif User.query.filter_by(username=username).first():
                flash("That username is already taken.", "error")
            else:
                user = User(username=username)
                user.set_password(password)
                db.session.add(user)
                db.session.commit()
                login_user(user)
                return redirect(url_for("books"))
        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if current_user.is_authenticated:
            return redirect(url_for("books"))
        if request.method == "POST":
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")
            user = User.query.filter_by(username=username).first()
            if user and user.check_password(password):
                login_user(user)
                return redirect(url_for("books"))
            flash("Invalid username or password.", "error")
        return render_template("login.html")

    @app.route("/logout")
    @login_required
    def logout():
        logout_user()
        return redirect(url_for("login"))

    @app.route("/books")
    @login_required
    def books():
        status_filter = request.args.get("status")
        query = Book.query.filter_by(user_id=current_user.id)
        if status_filter in STATUSES:
            query = query.filter_by(status=status_filter)
        items = query.order_by(Book.id.desc()).all()
        return render_template(
            "books.html", books=items, statuses=STATUSES,
            active_status=status_filter,
        )

    @app.route("/books/add", methods=["POST"])
    @login_required
    def add_book():
        title = request.form.get("title", "").strip()
        author = request.form.get("author", "").strip()
        status = request.form.get("status", "to-read")
        if not title or not author:
            flash("Title and author are required.", "error")
            return redirect(url_for("books"))
        if status not in STATUSES:
            status = "to-read"
        book = Book(
            title=title, author=author, status=status,
            user_id=current_user.id,
        )
        db.session.add(book)
        db.session.commit()
        flash("Book added.", "success")
        return redirect(url_for("books"))

    def _owned_book_or_404(book_id):
        book = db.session.get(Book, book_id)
        if book is None:
            abort(404)
        if book.user_id != current_user.id:
            abort(403)
        return book

    @app.route("/books/<int:book_id>/update", methods=["POST"])
    @login_required
    def update_book(book_id):
        book = _owned_book_or_404(book_id)
        status = request.form.get("status")
        if status in STATUSES:
            book.status = status
        rating_raw = request.form.get("rating", "")
        if rating_raw == "":
            book.rating = None
        else:
            try:
                rating = int(rating_raw)
                book.rating = rating if 1 <= rating <= 5 else book.rating
            except ValueError:
                pass
        db.session.commit()
        flash("Book updated.", "success")
        return redirect(url_for("books"))

    @app.route("/books/<int:book_id>/delete", methods=["POST"])
    @login_required
    def delete_book(book_id):
        book = _owned_book_or_404(book_id)
        db.session.delete(book)
        db.session.commit()
        flash("Book removed.", "success")
        return redirect(url_for("books"))


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5034, debug=True)
