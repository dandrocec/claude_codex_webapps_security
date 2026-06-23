"""FastAPI application: routes, middleware and request handling."""
from __future__ import annotations

import re
import sys
import traceback

from fastapi import Depends, FastAPI, Form, HTTPException, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from .config import settings
from .db import SessionLocal, init_db
from .models import Job, Session as SessionModel, User
from .runner import submit_job
from . import security

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = FastAPI(title="Job Runner", docs_url=None, redoc_url=None, openapi_url=None)

templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))
# Jinja2 autoescaping is enabled by default for .html templates, which gives
# context-aware HTML output encoding and prevents stored/reflected XSS.

app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")


@app.on_event("startup")
def _startup() -> None:
    init_db()


# ---------------------------------------------------------------------------
# DB dependency
# ---------------------------------------------------------------------------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Middleware: security headers + generic error handling
# ---------------------------------------------------------------------------
@app.middleware("http")
async def security_and_errors(request: Request, call_next):
    try:
        response = await call_next(request)
    except HTTPException:
        raise
    except Exception:
        # Do not leak stack traces or internal details to the client.
        # Log full detail server-side only.
        print("[ERROR] Unhandled exception:", file=sys.stderr)
        traceback.print_exc()
        response = templates.TemplateResponse(
            "error.html",
            {"request": request, "message": "An internal error occurred."},
            status_code=500,
        )
    security.apply_security_headers(response, https=request.url.scheme == "https")
    return response


# ---------------------------------------------------------------------------
# Auth helpers / dependencies
# ---------------------------------------------------------------------------
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")


def _current_session(request: Request, db: DbSession) -> SessionModel | None:
    token = request.cookies.get(settings.COOKIE_NAME)
    return security.get_session(db, token)


def require_user(request: Request, db: DbSession = Depends(get_db)):
    session = _current_session(request, db)
    if session is None:
        raise HTTPException(status_code=status.HTTP_303_SEE_OTHER, headers={"Location": "/login"})
    user = db.get(User, session.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_303_SEE_OTHER, headers={"Location": "/login"})
    return session, user


def require_csrf(request: Request, session: SessionModel, submitted: str | None) -> None:
    if not security.csrf_valid(session, submitted):
        raise HTTPException(status_code=403, detail="Invalid or missing CSRF token.")


# Redirect HTTPExceptions that carry a Location header (used for auth redirects).
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    if exc.status_code == status.HTTP_303_SEE_OTHER and exc.headers and "Location" in exc.headers:
        resp = RedirectResponse(exc.headers["Location"], status_code=303)
    else:
        resp = templates.TemplateResponse(
            "error.html",
            {"request": request, "message": exc.detail if isinstance(exc.detail, str) else "Request failed."},
            status_code=exc.status_code,
        )
    security.apply_security_headers(resp, https=request.url.scheme == "https")
    return resp


# ---------------------------------------------------------------------------
# Routes: auth
# ---------------------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
def index(request: Request, db: DbSession = Depends(get_db)):
    session = _current_session(request, db)
    if session is None:
        return RedirectResponse("/login", status_code=303)
    return RedirectResponse("/jobs", status_code=303)


@app.get("/register", response_class=HTMLResponse)
def register_form(request: Request):
    return templates.TemplateResponse("register.html", {"request": request, "error": None})


@app.post("/register")
def register(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    password_confirm: str = Form(...),
    db: DbSession = Depends(get_db),
):
    username = username.strip()
    error = None
    if not USERNAME_RE.match(username):
        error = "Username must be 3-32 characters: letters, digits, '_', '.', '-'."
    elif len(password) < 10 or len(password) > 256:
        error = "Password must be between 10 and 256 characters."
    elif password != password_confirm:
        error = "Passwords do not match."
    else:
        # Parameterised query via the ORM prevents SQL injection.
        existing = db.execute(select(User).where(User.username == username)).scalar_one_or_none()
        if existing is not None:
            error = "That username is already taken."

    if error:
        return templates.TemplateResponse(
            "register.html", {"request": request, "error": error}, status_code=400
        )

    user = User(username=username, password_hash=security.hash_password(password))
    db.add(user)
    db.commit()

    session = security.create_session(db, user)
    resp = RedirectResponse("/jobs", status_code=303)
    security.set_session_cookie(resp, session.id)
    return resp


@app.get("/login", response_class=HTMLResponse)
def login_form(request: Request):
    return templates.TemplateResponse("login.html", {"request": request, "error": None})


@app.post("/login")
def login(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    db: DbSession = Depends(get_db),
):
    username = username.strip()
    user = db.execute(select(User).where(User.username == username)).scalar_one_or_none()

    # Verify even when the user does not exist to keep timing uniform and avoid
    # username enumeration. Always present a generic error.
    valid = False
    if user is not None:
        valid = security.verify_password(user.password_hash, password)
        if valid and security.needs_rehash(user.password_hash):
            user.password_hash = security.hash_password(password)
            db.commit()
    else:
        # Spend roughly the same time hashing a dummy value.
        security.hash_password(password)

    if not user or not valid:
        return templates.TemplateResponse(
            "login.html",
            {"request": request, "error": "Invalid username or password."},
            status_code=401,
        )

    session = security.create_session(db, user)
    resp = RedirectResponse("/jobs", status_code=303)
    security.set_session_cookie(resp, session.id)
    return resp


@app.post("/logout")
def logout(
    request: Request,
    csrf_token: str = Form(...),
    db: DbSession = Depends(get_db),
):
    session = _current_session(request, db)
    if session is not None:
        require_csrf(request, session, csrf_token)
        security.destroy_session(db, session.id)
    resp = RedirectResponse("/login", status_code=303)
    security.clear_session_cookie(resp)
    return resp


# ---------------------------------------------------------------------------
# Routes: jobs
# ---------------------------------------------------------------------------
@app.get("/jobs", response_class=HTMLResponse)
def list_jobs(request: Request, auth=Depends(require_user), db: DbSession = Depends(get_db)):
    session, user = auth
    # Access control: only this user's jobs are ever selected.
    jobs = db.execute(
        select(Job).where(Job.user_id == user.id).order_by(Job.created_at.desc())
    ).scalars().all()
    return templates.TemplateResponse(
        "jobs.html",
        {
            "request": request,
            "user": user,
            "jobs": jobs,
            "csrf_token": session.csrf_token,
        },
    )


@app.post("/jobs")
def create_job(
    request: Request,
    name: str = Form(...),
    command: str = Form(...),
    csrf_token: str = Form(...),
    auth=Depends(require_user),
    db: DbSession = Depends(get_db),
):
    session, user = auth
    require_csrf(request, session, csrf_token)

    name = name.strip()
    command = command.replace("\r\n", "\n").strip()

    error = None
    if not name or len(name) > 120:
        error = "Job name is required and must be at most 120 characters."
    elif not command:
        error = "Command/script cannot be empty."
    elif len(command) > 50_000:
        error = "Command/script is too long (max 50,000 characters)."

    if error:
        jobs = db.execute(
            select(Job).where(Job.user_id == user.id).order_by(Job.created_at.desc())
        ).scalars().all()
        return templates.TemplateResponse(
            "jobs.html",
            {
                "request": request,
                "user": user,
                "jobs": jobs,
                "csrf_token": session.csrf_token,
                "error": error,
            },
            status_code=400,
        )

    job = Job(user_id=user.id, name=name, command=command, status="pending")
    db.add(job)
    db.commit()
    db.refresh(job)

    submit_job(job.id)

    return RedirectResponse(f"/jobs/{job.id}", status_code=303)


@app.get("/jobs/{job_id}", response_class=HTMLResponse)
def job_detail(
    job_id: int,
    request: Request,
    auth=Depends(require_user),
    db: DbSession = Depends(get_db),
):
    session, user = auth
    job = db.get(Job, job_id)
    # Access control / IDOR prevention: 404 unless the job belongs to the user.
    if job is None or job.user_id != user.id:
        raise HTTPException(status_code=404, detail="Job not found.")
    return templates.TemplateResponse(
        "job_detail.html",
        {
            "request": request,
            "user": user,
            "job": job,
            "csrf_token": session.csrf_token,
        },
    )


@app.post("/jobs/{job_id}/delete")
def delete_job(
    job_id: int,
    request: Request,
    csrf_token: str = Form(...),
    auth=Depends(require_user),
    db: DbSession = Depends(get_db),
):
    session, user = auth
    require_csrf(request, session, csrf_token)
    job = db.get(Job, job_id)
    if job is None or job.user_id != user.id:
        raise HTTPException(status_code=404, detail="Job not found.")
    db.delete(job)
    db.commit()
    return RedirectResponse("/jobs", status_code=303)


@app.get("/healthz")
def healthz():
    return {"status": "ok"}
