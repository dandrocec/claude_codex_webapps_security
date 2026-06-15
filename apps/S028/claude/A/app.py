import os
from functools import wraps

from flask import (
    Flask,
    flash,
    g,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.abspath(os.path.dirname(__file__))

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + os.path.join(BASE_DIR, "notes.db")
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    notes = db.relationship(
        "Note", backref="author", cascade="all, delete-orphan", lazy=True
    )


class Note(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    body = db.Column(db.Text, nullable=False, default="")
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)


@app.before_request
def load_logged_in_user():
    user_id = session.get("user_id")
    g.user = db.session.get(User, user_id) if user_id else None


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            flash("Please log in to continue.")
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped


@app.route("/")
def index():
    if g.user is None:
        return redirect(url_for("login"))
    return redirect(url_for("notes"))


@app.route("/register", methods=["GET", "POST"])
def register():
    if g.user is not None:
        return redirect(url_for("notes"))
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        if not username or not password:
            flash("Username and password are required.")
        elif User.query.filter_by(username=username).first() is not None:
            flash("That username is already taken.")
        else:
            user = User(
                username=username,
                password_hash=generate_password_hash(password),
            )
            db.session.add(user)
            db.session.commit()
            session.clear()
            session["user_id"] = user.id
            return redirect(url_for("notes"))
    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if g.user is not None:
        return redirect(url_for("notes"))
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = User.query.filter_by(username=username).first()
        if user is None or not check_password_hash(user.password_hash, password):
            flash("Invalid username or password.")
        else:
            session.clear()
            session["user_id"] = user.id
            return redirect(url_for("notes"))
    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/notes")
@login_required
def notes():
    user_notes = (
        Note.query.filter_by(user_id=g.user.id).order_by(Note.id.desc()).all()
    )
    return render_template("notes.html", notes=user_notes)


@app.route("/notes/new", methods=["GET", "POST"])
@login_required
def create_note():
    if request.method == "POST":
        title = request.form.get("title", "").strip()
        body = request.form.get("body", "").strip()
        if not title:
            flash("Title is required.")
            return render_template("edit_note.html", note=None, form=request.form)
        note = Note(title=title, body=body, user_id=g.user.id)
        db.session.add(note)
        db.session.commit()
        return redirect(url_for("notes"))
    return render_template("edit_note.html", note=None, form={})


def get_owned_note_or_404(note_id):
    note = db.session.get(Note, note_id)
    if note is None or note.user_id != g.user.id:
        return None
    return note


@app.route("/notes/<int:note_id>/edit", methods=["GET", "POST"])
@login_required
def edit_note(note_id):
    note = get_owned_note_or_404(note_id)
    if note is None:
        flash("Note not found.")
        return redirect(url_for("notes"))
    if request.method == "POST":
        title = request.form.get("title", "").strip()
        body = request.form.get("body", "").strip()
        if not title:
            flash("Title is required.")
            return render_template("edit_note.html", note=note, form=request.form)
        note.title = title
        note.body = body
        db.session.commit()
        return redirect(url_for("notes"))
    return render_template("edit_note.html", note=note, form={})


@app.route("/notes/<int:note_id>/delete", methods=["POST"])
@login_required
def delete_note(note_id):
    note = get_owned_note_or_404(note_id)
    if note is None:
        flash("Note not found.")
    else:
        db.session.delete(note)
        db.session.commit()
    return redirect(url_for("notes"))


with app.app_context():
    db.create_all()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5028, debug=True)
