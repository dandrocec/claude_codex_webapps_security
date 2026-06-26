from __future__ import annotations

import os
import secrets
import shlex
import subprocess
import sys
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Depends, FastAPI, Form, HTTPException, Request, status
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker
from starlette.middleware.sessions import SessionMiddleware

BASE_DIR = Path(__file__).resolve().parent
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR.parent / 'jobs.db'}")
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY environment variable is required")

SESSION_COOKIE_SECURE = os.getenv("SESSION_COOKIE_SECURE", "true").lower() not in {"0", "false", "no"}
MAX_COMMAND_LENGTH = int(os.getenv("MAX_COMMAND_LENGTH", "2000"))
JOB_TIMEOUT_SECONDS = int(os.getenv("JOB_TIMEOUT_SECONDS", "30"))
MAX_LOG_BYTES = int(os.getenv("MAX_LOG_BYTES", "65536"))

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
password_hasher = PasswordHasher()
job_threads: set[int] = set()
job_threads_lock = threading.Lock()


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    jobs: Mapped[list["Job"]] = relationship(back_populates="owner")


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    command: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    output: Mapped[str] = mapped_column(Text, default="")
    exit_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    owner: Mapped[User] = relationship(back_populates="jobs")


def create_app() -> FastAPI:
    Base.metadata.create_all(bind=engine)
    app = FastAPI(title="FastAPI Job Runner", debug=False)
    app.add_middleware(
        SessionMiddleware,
        secret_key=SECRET_KEY,
        session_cookie="jobrunner_session",
        same_site="lax",
        https_only=SESSION_COOKIE_SECURE,
        max_age=60 * 60 * 8,
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; style-src 'self' 'unsafe-inline'; "
            "form-action 'self'; frame-ancestors 'none'; base-uri 'self'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        if request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        return templates.TemplateResponse(
            request,
            "error.html",
            {"message": "An internal error occurred."},
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    @app.exception_handler(HTTPException)
    async def safe_http_exception_handler(request: Request, exc: HTTPException):
        if exc.status_code >= 500:
            return templates.TemplateResponse(
                request,
                "error.html",
                {"message": "An internal error occurred."},
                status_code=exc.status_code,
            )
        return await http_exception_handler(request, exc)

    return app


app = create_app()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def normalise_username(username: str) -> str:
    value = username.strip().lower()
    if not (3 <= len(value) <= 32):
        raise ValueError("Username must be 3 to 32 characters.")
    if not all(char.isalnum() or char in {"_", "-"} for char in value):
        raise ValueError("Username may contain letters, numbers, underscores, and hyphens.")
    return value


def validate_password(password: str) -> str:
    if len(password) < 12:
        raise ValueError("Password must be at least 12 characters.")
    if len(password) > 256:
        raise ValueError("Password is too long.")
    return password


def validate_job(kind: str, command: str) -> tuple[str, str]:
    kind = kind.strip()
    command = command.strip()
    if kind not in {"command", "python"}:
        raise ValueError("Unsupported job type.")
    if not command:
        raise ValueError("Job content is required.")
    if len(command) > MAX_COMMAND_LENGTH:
        raise ValueError(f"Job content must be {MAX_COMMAND_LENGTH} characters or fewer.")
    if "\x00" in command:
        raise ValueError("Job content contains an invalid character.")
    return kind, command


def set_flash(request: Request, message: str) -> None:
    request.session["flash"] = message


def pop_flash(request: Request) -> str | None:
    return request.session.pop("flash", None)


def issue_csrf_token(request: Request) -> str:
    token = request.session.get("csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        request.session["csrf_token"] = token
    return token


def verify_csrf(request: Request, csrf_token: str) -> None:
    expected = request.session.get("csrf_token")
    if not expected or not secrets.compare_digest(expected, csrf_token):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid CSRF token")


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    user_id = request.session.get("user_id")
    if not isinstance(user_id, int):
        raise HTTPException(status_code=status.HTTP_303_SEE_OTHER, headers={"Location": "/login"})
    user = db.get(User, user_id)
    if user is None:
        request.session.clear()
        raise HTTPException(status_code=status.HTTP_303_SEE_OTHER, headers={"Location": "/login"})
    return user


def redirect(path: str) -> RedirectResponse:
    return RedirectResponse(path, status_code=status.HTTP_303_SEE_OTHER)


@app.get("/", response_class=HTMLResponse)
def index(request: Request, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    if not isinstance(user_id, int):
        return redirect("/login")
    user = db.get(User, user_id)
    if user is None:
        request.session.clear()
        return redirect("/login")
    jobs = db.scalars(select(Job).where(Job.user_id == user.id).order_by(Job.created_at.desc())).all()
    return templates.TemplateResponse(
        request,
        "index.html",
        {"user": user, "jobs": jobs, "csrf_token": issue_csrf_token(request), "flash": pop_flash(request)},
    )


@app.get("/register", response_class=HTMLResponse)
def register_form(request: Request):
    return templates.TemplateResponse(
        request,
        "register.html",
        {"csrf_token": issue_csrf_token(request), "flash": pop_flash(request)},
    )


@app.post("/register")
def register(
    request: Request,
    username: Annotated[str, Form()],
    password: Annotated[str, Form()],
    csrf_token: Annotated[str, Form()],
    db: Session = Depends(get_db),
):
    verify_csrf(request, csrf_token)
    try:
        clean_username = normalise_username(username)
        clean_password = validate_password(password)
    except ValueError as exc:
        set_flash(request, str(exc))
        return redirect("/register")

    user = User(username=clean_username, password_hash=password_hasher.hash(clean_password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        set_flash(request, "That username is already taken.")
        return redirect("/register")
    request.session.clear()
    request.session["user_id"] = user.id
    issue_csrf_token(request)
    return redirect("/")


@app.get("/login", response_class=HTMLResponse)
def login_form(request: Request):
    return templates.TemplateResponse(
        request,
        "login.html",
        {"csrf_token": issue_csrf_token(request), "flash": pop_flash(request)},
    )


@app.post("/login")
def login(
    request: Request,
    username: Annotated[str, Form()],
    password: Annotated[str, Form()],
    csrf_token: Annotated[str, Form()],
    db: Session = Depends(get_db),
):
    verify_csrf(request, csrf_token)
    try:
        clean_username = normalise_username(username)
    except ValueError:
        clean_username = ""
    user = db.scalar(select(User).where(User.username == clean_username))
    valid = False
    if user is not None:
        try:
            valid = password_hasher.verify(user.password_hash, password)
        except VerifyMismatchError:
            valid = False
    if not valid:
        set_flash(request, "Invalid username or password.")
        return redirect("/login")
    request.session.clear()
    request.session["user_id"] = user.id
    issue_csrf_token(request)
    return redirect("/")


@app.post("/logout")
def logout(request: Request, csrf_token: Annotated[str, Form()]):
    verify_csrf(request, csrf_token)
    request.session.clear()
    return redirect("/login")


@app.post("/jobs")
def create_job(
    request: Request,
    kind: Annotated[str, Form()],
    command: Annotated[str, Form()],
    csrf_token: Annotated[str, Form()],
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    verify_csrf(request, csrf_token)
    try:
        clean_kind, clean_command = validate_job(kind, command)
    except ValueError as exc:
        set_flash(request, str(exc))
        return redirect("/")
    job = Job(user_id=user.id, kind=clean_kind, command=clean_command)
    db.add(job)
    db.commit()
    start_job(job.id)
    set_flash(request, "Job submitted.")
    return redirect(f"/jobs/{job.id}")


@app.get("/jobs/{job_id}", response_class=HTMLResponse)
def show_job(job_id: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    job = db.scalar(select(Job).where(Job.id == job_id, Job.user_id == user.id))
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return templates.TemplateResponse(
        request,
        "job.html",
        {"user": user, "job": job, "csrf_token": issue_csrf_token(request), "flash": pop_flash(request)},
    )


def start_job(job_id: int) -> None:
    with job_threads_lock:
        if job_id in job_threads:
            return
        job_threads.add(job_id)
    thread = threading.Thread(target=run_job, args=(job_id,), daemon=True)
    thread.start()


def run_job(job_id: int) -> None:
    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if job is None:
            return
        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        db.commit()

        try:
            output, exit_code = execute_job(job.kind, job.command)
            job.output = output
            job.exit_code = exit_code
            job.status = "succeeded" if exit_code == 0 else "failed"
        except subprocess.TimeoutExpired as exc:
            partial = ((exc.stdout or "") + (exc.stderr or ""))[:MAX_LOG_BYTES]
            job.output = partial + "\nJob timed out."
            job.exit_code = None
            job.status = "timed_out"
        except Exception:
            job.output = "Job failed before output could be captured."
            job.exit_code = None
            job.status = "failed"
        job.finished_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()
        with job_threads_lock:
            job_threads.discard(job_id)


def execute_job(kind: str, command: str) -> tuple[str, int]:
    with tempfile.TemporaryDirectory(prefix="jobrunner_") as tmpdir:
        if kind == "python":
            script_path = Path(tmpdir) / "script.py"
            script_path.write_text(command, encoding="utf-8")
            args = [sys.executable, "-I", str(script_path)]
        else:
            args = shlex.split(command, posix=os.name != "nt")
            if not args:
                raise ValueError("Empty command")
        completed = subprocess.run(
            args,
            cwd=tmpdir,
            text=True,
            capture_output=True,
            timeout=JOB_TIMEOUT_SECONDS,
            shell=False,
            env={"PATH": os.getenv("PATH", ""), "PYTHONIOENCODING": "utf-8"},
        )
    combined = (completed.stdout or "") + (completed.stderr or "")
    if len(combined) > MAX_LOG_BYTES:
        combined = combined[:MAX_LOG_BYTES] + "\n[output truncated]"
    return combined, completed.returncode


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
