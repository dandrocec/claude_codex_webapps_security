"""Book CRUD scoped to the logged-in user.

Every query filters on ``user_id = current_user.id`` so a user can only read or
mutate their own rows. Combined with that filter, ownership-based access
control prevents IDOR: requesting another user's book id simply returns
nothing / 404.
"""
from flask import (
    Blueprint,
    abort,
    flash,
    redirect,
    render_template,
    url_for,
)
from flask_login import current_user, login_required

from db import get_db
from forms import BookForm, DeleteForm

bp = Blueprint("books", __name__)


def _get_owned_book(book_id: int):
    """Fetch a book only if it belongs to the current user, else 404."""
    db = get_db()
    row = db.execute(
        "SELECT * FROM books WHERE id = ? AND user_id = ?",
        (book_id, current_user.id),
    ).fetchone()
    if row is None:
        abort(404)
    return row


@bp.route("/")
@login_required
def index():
    db = get_db()
    books = db.execute(
        "SELECT * FROM books WHERE user_id = ? ORDER BY "
        "CASE status WHEN 'reading' THEN 0 WHEN 'to-read' THEN 1 ELSE 2 END, "
        "title COLLATE NOCASE",
        (current_user.id,),
    ).fetchall()
    return render_template("index.html", books=books, delete_form=DeleteForm())


@bp.route("/books/add", methods=["GET", "POST"])
@login_required
def add():
    form = BookForm()
    if form.validate_on_submit():
        db = get_db()
        db.execute(
            "INSERT INTO books (user_id, title, author, status, rating) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                current_user.id,
                form.title.data.strip(),
                form.author.data.strip(),
                form.status.data,
                form.rating.data or None,
            ),
        )
        db.commit()
        flash("Book added.", "success")
        return redirect(url_for("books.index"))
    return render_template("book_form.html", form=form, heading="Add a book")


@bp.route("/books/<int:book_id>/edit", methods=["GET", "POST"])
@login_required
def edit(book_id: int):
    book = _get_owned_book(book_id)
    form = BookForm(data={
        "title": book["title"],
        "author": book["author"],
        "status": book["status"],
        "rating": str(book["rating"]) if book["rating"] is not None else "",
    })
    if form.validate_on_submit():
        db = get_db()
        db.execute(
            "UPDATE books SET title = ?, author = ?, status = ?, rating = ?, "
            "updated_at = datetime('now') WHERE id = ? AND user_id = ?",
            (
                form.title.data.strip(),
                form.author.data.strip(),
                form.status.data,
                form.rating.data or None,
                book_id,
                current_user.id,
            ),
        )
        db.commit()
        flash("Book updated.", "success")
        return redirect(url_for("books.index"))
    return render_template("book_form.html", form=form, heading="Edit book")


@bp.route("/books/<int:book_id>/delete", methods=["POST"])
@login_required
def delete(book_id: int):
    form = DeleteForm()
    if not form.validate_on_submit():
        abort(400)
    _get_owned_book(book_id)  # 404 if not owned
    db = get_db()
    db.execute(
        "DELETE FROM books WHERE id = ? AND user_id = ?",
        (book_id, current_user.id),
    )
    db.commit()
    flash("Book deleted.", "success")
    return redirect(url_for("books.index"))
