"""A small blog web application built with Flask.

Features:
  * User registration and login (passwords stored hashed).
  * Logged-in users can create, edit and delete their own posts.
  * Public home page listing all posts (newest first) and per-post detail pages.
  * All data persisted in a local SQLite database.

Run with ``python app.py`` and visit http://localhost:5026
"""

import os
from datetime import datetime

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
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.abspath(os.path.dirname(__file__))

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + os.path.join(BASE_DIR, "blog.db")
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)

login_manager = LoginManager(app)
login_manager.login_view = "login"
login_manager.login_message_category = "error"


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    posts = db.relationship("Post", backref="author", cascade="all, delete-orphan")

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Post(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    body = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)


@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))


# --------------------------------------------------------------------------- #
# Authentication routes
# --------------------------------------------------------------------------- #
@app.route("/register", methods=["GET", "POST"])
def register():
    if current_user.is_authenticated:
        return redirect(url_for("index"))

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
            flash("Account created. Please log in.", "success")
            return redirect(url_for("login"))

    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("index"))

    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = User.query.filter_by(username=username).first()

        if user is None or not user.check_password(password):
            flash("Invalid username or password.", "error")
        else:
            login_user(user)
            next_page = request.args.get("next")
            return redirect(next_page or url_for("index"))

    return render_template("login.html")


@app.route("/logout")
@login_required
def logout():
    logout_user()
    flash("You have been logged out.", "success")
    return redirect(url_for("index"))


# --------------------------------------------------------------------------- #
# Post routes
# --------------------------------------------------------------------------- #
@app.route("/")
def index():
    posts = Post.query.order_by(Post.created_at.desc()).all()
    return render_template("index.html", posts=posts)


@app.route("/post/<int:post_id>")
def post_detail(post_id):
    post = db.session.get(Post, post_id)
    if post is None:
        abort(404)
    return render_template("post_detail.html", post=post)


@app.route("/post/new", methods=["GET", "POST"])
@login_required
def create_post():
    if request.method == "POST":
        title = request.form.get("title", "").strip()
        body = request.form.get("body", "").strip()

        if not title or not body:
            flash("Both a title and a body are required.", "error")
        else:
            post = Post(title=title, body=body, author=current_user)
            db.session.add(post)
            db.session.commit()
            flash("Post published.", "success")
            return redirect(url_for("post_detail", post_id=post.id))

    return render_template("post_form.html", post=None)


@app.route("/post/<int:post_id>/edit", methods=["GET", "POST"])
@login_required
def edit_post(post_id):
    post = db.session.get(Post, post_id)
    if post is None:
        abort(404)
    if post.author != current_user:
        abort(403)

    if request.method == "POST":
        title = request.form.get("title", "").strip()
        body = request.form.get("body", "").strip()

        if not title or not body:
            flash("Both a title and a body are required.", "error")
        else:
            post.title = title
            post.body = body
            db.session.commit()
            flash("Post updated.", "success")
            return redirect(url_for("post_detail", post_id=post.id))

    return render_template("post_form.html", post=post)


@app.route("/post/<int:post_id>/delete", methods=["POST"])
@login_required
def delete_post(post_id):
    post = db.session.get(Post, post_id)
    if post is None:
        abort(404)
    if post.author != current_user:
        abort(403)

    db.session.delete(post)
    db.session.commit()
    flash("Post deleted.", "success")
    return redirect(url_for("index"))


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
with app.app_context():
    db.create_all()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5026, debug=True)
