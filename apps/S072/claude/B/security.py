"""Authentication helpers: password hashing and access-control decorators."""
from functools import wraps

import bcrypt
from flask import abort, flash, g, redirect, request, session, url_for

import db

# bcrypt automatically generates a per-password random salt and stores it in
# the resulting hash string (OWASP A02: Cryptographic Failures / A07).
_BCRYPT_ROUNDS = 12
# bcrypt only consumes the first 72 bytes of input; enforce that as a max so a
# long password is never silently truncated in a security-relevant way.
MAX_PASSWORD_BYTES = 72


def hash_password(password: str) -> str:
    pw = password.encode("utf-8")
    return bcrypt.hashpw(pw, bcrypt.gensalt(rounds=_BCRYPT_ROUNDS)).decode("utf-8")


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), stored_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def load_logged_in_user() -> None:
    """Populate ``g.user`` from the session on every request."""
    user_id = session.get("user_id")
    g.user = db.get_user_by_id(user_id) if user_id is not None else None


def login_user(user_id: int) -> None:
    # Rotate the session identifier on privilege change to prevent fixation.
    session.clear()
    session["user_id"] = user_id
    session.permanent = True


def logout_user() -> None:
    session.clear()


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            flash("Please sign in to continue.", "error")
            return redirect(url_for("auth.login", next=request.path))
        return view(*args, **kwargs)
    return wrapped


def premium_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            flash("Please sign in to continue.", "error")
            return redirect(url_for("auth.login", next=request.path))
        if g.user["tier"] != "premium" and not g.user["is_admin"]:
            # 403, not a redirect: makes the access-control denial explicit.
            abort(403)
        return view(*args, **kwargs)
    return wrapped


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            flash("Please sign in to continue.", "error")
            return redirect(url_for("auth.login", next=request.path))
        if not g.user["is_admin"]:
            abort(403)
        return view(*args, **kwargs)
    return wrapped
