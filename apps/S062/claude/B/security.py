"""Authentication helpers: password hashing and access-control decorators."""
import functools

from argon2 import PasswordHasher
from flask import flash, g, redirect, session, url_for

from db import get_db

# Argon2id with library defaults — a strong, salted, memory-hard algorithm.
_hasher = PasswordHasher()

# A precomputed valid hash used to perform constant work when an email is
# unknown, so login timing does not reveal whether an account exists.
DUMMY_HASH = _hasher.hash("a-non-matching-dummy-password")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(stored_hash: str, password: str) -> bool:
    # Any verification failure (mismatch or malformed hash) is a non-match.
    try:
        return _hasher.verify(stored_hash, password)
    except Exception:
        return False


def needs_rehash(stored_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(stored_hash)
    except Exception:
        return False


def load_logged_in_user() -> None:
    """Populate g.user from the session on every request."""
    user_id = session.get("user_id")
    if user_id is None:
        g.user = None
        return
    g.user = get_db().execute(
        "SELECT id, email, name, role FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    if g.user is None:
        # Stale session referencing a deleted user.
        session.clear()


def login_required(view):
    @functools.wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            flash("Please sign in to continue.", "error")
            return redirect(url_for("auth.login"))
        return view(*args, **kwargs)

    return wrapped


def role_required(*roles):
    def decorator(view):
        @functools.wraps(view)
        def wrapped(*args, **kwargs):
            if g.user is None:
                flash("Please sign in to continue.", "error")
                return redirect(url_for("auth.login"))
            if g.user["role"] not in roles:
                # Do not reveal resource existence — just forbid.
                from flask import abort

                abort(403)
            return view(*args, **kwargs)

        return wrapped

    return decorator
