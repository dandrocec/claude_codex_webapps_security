"""Password hashing and authentication/authorization helpers."""
import functools

import bcrypt
from flask import abort, g, redirect, session, url_for

from db import get_user_by_id

# bcrypt has a 72-byte input limit; we pre-hash longer inputs is overkill here,
# instead we simply cap the accepted password length in the form validators.


def hash_password(password: str) -> str:
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(
            password.encode("utf-8"), password_hash.encode("utf-8")
        )
    except (ValueError, TypeError):
        return False


def current_user():
    """Load the logged-in admin for this request, or None."""
    if "_loaded_user" in g:
        return g._loaded_user

    user = None
    uid = session.get("user_id")
    if uid is not None:
        row = get_user_by_id(uid)
        # The account must still exist, still be an active admin. This re-checks
        # authorization on every request so a deactivated admin loses access
        # immediately.
        if row and row["is_admin"] and row["is_active"]:
            user = row
    g._loaded_user = user
    return user


def login_required(view):
    @functools.wraps(view)
    def wrapped(*args, **kwargs):
        if current_user() is None:
            session.clear()
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped
