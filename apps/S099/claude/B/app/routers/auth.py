"""User registration, login, logout and home page."""
from fastapi import APIRouter, Request, Depends, Form, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..deps import get_current_user, render
from ..security import hash_secret, verify_secret, needs_rehash
from ..csrf import validate_csrf
from ..validators import (
    validate_username,
    validate_user_email,
    validate_password,
)

router = APIRouter()


@router.get("/")
def home(request: Request, user: User | None = Depends(get_current_user)):
    return render(request, "home.html", {"current_user": user})


@router.get("/register")
def register_form(request: Request, user: User | None = Depends(get_current_user)):
    if user:
        return RedirectResponse("/", status_code=status.HTTP_303_SEE_OTHER)
    return render(request, "register.html", {"errors": [], "values": {}})


@router.post("/register")
def register(
    request: Request,
    db: Session = Depends(get_db),
    csrf_token: str = Form(""),
    username: str = Form(""),
    email: str = Form(""),
    password: str = Form(""),
):
    if not validate_csrf(request, csrf_token):
        return render(request, "register.html",
                      {"errors": ["Invalid or expired form token. Please try again."],
                       "values": {"username": username, "email": email}},
                      status_code=400)

    errors = []
    username_clean, e = validate_username(username)
    if e:
        errors.append(e)
    email_clean, e = validate_user_email(email)
    if e:
        errors.append(e)
    _, e = validate_password(password)
    if e:
        errors.append(e)

    if errors:
        return render(request, "register.html",
                      {"errors": errors, "values": {"username": username, "email": email}},
                      status_code=400)

    # Uniqueness check via parameterised query.
    existing = db.execute(
        select(User).where((User.username == username_clean) | (User.email == email_clean))
    ).scalar_one_or_none()
    if existing:
        return render(request, "register.html",
                      {"errors": ["That username or email is already registered."],
                       "values": {"username": username, "email": email}},
                      status_code=400)

    user = User(
        username=username_clean,
        email=email_clean,
        password_hash=hash_secret(password),
        is_admin=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Log the new user in (rotate session id to prevent fixation).
    request.session.clear()
    request.session["user_id"] = user.id
    return RedirectResponse("/clients", status_code=status.HTTP_303_SEE_OTHER)


@router.get("/login")
def login_form(request: Request, user: User | None = Depends(get_current_user)):
    if user:
        return RedirectResponse("/", status_code=status.HTTP_303_SEE_OTHER)
    next_url = request.query_params.get("next", "")
    return render(request, "login.html", {"errors": [], "next": next_url})


@router.post("/login")
def login(
    request: Request,
    db: Session = Depends(get_db),
    csrf_token: str = Form(""),
    username: str = Form(""),
    password: str = Form(""),
    next: str = Form(""),
):
    if not validate_csrf(request, csrf_token):
        return render(request, "login.html",
                      {"errors": ["Invalid or expired form token. Please try again."],
                       "next": next}, status_code=400)

    user = db.execute(
        select(User).where(User.username == (username or "").strip())
    ).scalar_one_or_none()

    # Always perform a hashing operation to reduce username-enumeration timing
    # signals, even when the user does not exist.
    if user is None:
        hash_secret(password or "")
        return render(request, "login.html",
                      {"errors": ["Invalid username or password."], "next": next},
                      status_code=401)

    if not verify_secret(user.password_hash, password or ""):
        return render(request, "login.html",
                      {"errors": ["Invalid username or password."], "next": next},
                      status_code=401)

    if needs_rehash(user.password_hash):
        user.password_hash = hash_secret(password)
        db.commit()

    # Prevent session fixation: start a fresh session on privilege change.
    request.session.clear()
    request.session["user_id"] = user.id

    # Only allow internal, same-site relative redirects (open-redirect guard).
    target = next if next.startswith("/") and not next.startswith("//") else "/clients"
    return RedirectResponse(target, status_code=status.HTTP_303_SEE_OTHER)


@router.post("/logout")
def logout(request: Request, csrf_token: str = Form("")):
    if validate_csrf(request, csrf_token):
        request.session.clear()
    return RedirectResponse("/", status_code=status.HTTP_303_SEE_OTHER)
