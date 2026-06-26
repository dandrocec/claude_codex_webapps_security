import asyncio
import os
import secrets
import sys
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Generator

from fastapi import Depends, FastAPI, Form, HTTPException, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from passlib.context import CryptContext
from sqlalchemy import DateTime, Enum as SQLEnum, ForeignKey, Integer, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker
from starlette.middleware.sessions import SessionMiddleware


BASE_DIR = Path(__file__).resolve().parent.parent
DATABASE_URL = os.getenv("JOB_RUNNER_DATABASE_URL", f"sqlite:///{BASE_DIR / 'jobrunner.db'}")
SESSION_SECRET = os.getenv("JOB_RUNNER_SESSION_SECRET", secrets.token_hex(32))
ADMIN_USER = os.getenv("JOB_RUNNER_ADMIN_USER", "admin")
ADMIN_PASSWORD = os.getenv("JOB_RUNNER_ADMIN_PASSWORD", "admin123")
JOB_TIMEOUT_SECONDS = int(os.getenv("JOB_RUNNER_TIMEOUT_SECONDS", "300"))

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
templates = Jinja2Templates(directory=str(BASE_DIR / "app" / "templates"))

app = FastAPI(title="FastAPI Job Runner")
app.add_middleware(SessionMiddleware, secret_key=SESSION_SECRET, same_site="lax", https_only=False)


class Base(DeclarativeBase):
    pass


class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    timed_out = "timed_out"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    jobs: Mapped[list["Job"]] = relationship(back_populates="owner")


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(120))
    payload: Mapped[str] = mapped_column(Text)
    mode: Mapped[str] = mapped_column(String(20), default="command")
    status: Mapped[JobStatus] = mapped_column(SQLEnum(JobStatus), default=JobStatus.queued, index=True)
    exit_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stdout: Mapped[str] = mapped_column(Text, default="")
    stderr: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    owner: Mapped[User] = relationship(back_populates="jobs")


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def verify_password(plain_password: str, password_hash: str) -> bool:
    return pwd_context.verify(plain_password, password_hash)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_303_SEE_OTHER, headers={"Location": "/login"})
    user = db.get(User, user_id)
    if not user:
        request.session.clear()
        raise HTTPException(status_code=status.HTTP_303_SEE_OTHER, headers={"Location": "/login"})
    return user


def redirect(path: str) -> RedirectResponse:
    return RedirectResponse(path, status_code=status.HTTP_303_SEE_OTHER)


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        existing = db.scalar(select(User).where(User.username == ADMIN_USER))
        if not existing:
            db.add(User(username=ADMIN_USER, password_hash=hash_password(ADMIN_PASSWORD)))
            db.commit()


@app.get("/", response_class=HTMLResponse)
def home(request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> HTMLResponse:
    jobs = db.scalars(select(Job).where(Job.user_id == user.id).order_by(Job.created_at.desc())).all()
    return templates.TemplateResponse("index.html", {"request": request, "user": user, "jobs": jobs})


@app.get("/login", response_class=HTMLResponse)
def login_form(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("login.html", {"request": request, "error": None})


@app.post("/login")
def login(request: Request, username: str = Form(...), password: str = Form(...), db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == username))
    if not user or not verify_password(password, user.password_hash):
        return templates.TemplateResponse(
            "login.html",
            {"request": request, "error": "Invalid username or password."},
            status_code=status.HTTP_401_UNAUTHORIZED,
        )
    request.session["user_id"] = user.id
    return redirect("/")


@app.post("/logout")
def logout(request: Request):
    request.session.clear()
    return redirect("/login")


@app.post("/jobs")
async def create_job(
    title: str = Form(...),
    mode: str = Form(...),
    payload: str = Form(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    mode = mode if mode in {"command", "python"} else "command"
    job = Job(title=title.strip()[:120] or "Untitled job", mode=mode, payload=payload, user_id=user.id)
    db.add(job)
    db.commit()
    db.refresh(job)
    asyncio.create_task(run_job(job.id))
    return redirect(f"/jobs/{job.id}")


@app.get("/jobs/{job_id}", response_class=HTMLResponse)
def job_detail(
    job_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> HTMLResponse:
    job = db.get(Job, job_id)
    if not job or job.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return templates.TemplateResponse("job.html", {"request": request, "user": user, "job": job})


async def run_job(job_id: int) -> None:
    with SessionLocal() as db:
        job = db.get(Job, job_id)
        if not job:
            return
        job.status = JobStatus.running
        job.started_at = datetime.now(timezone.utc)
        db.commit()
        mode = job.mode
        payload = job.payload

    if mode == "python":
        args = [sys.executable, "-c", payload]
        shell = False
    else:
        args = payload
        shell = True

    stdout = ""
    stderr = ""
    exit_code: int | None = None
    final_status = JobStatus.failed

    try:
        if shell:
            process = await asyncio.create_subprocess_shell(
                args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        else:
            process = await asyncio.create_subprocess_exec(
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        out_bytes, err_bytes = await asyncio.wait_for(process.communicate(), timeout=JOB_TIMEOUT_SECONDS)
        stdout = out_bytes.decode(errors="replace")
        stderr = err_bytes.decode(errors="replace")
        exit_code = process.returncode
        final_status = JobStatus.succeeded if exit_code == 0 else JobStatus.failed
    except asyncio.TimeoutError:
        if "process" in locals() and process.returncode is None:
            process.kill()
            await process.communicate()
        stderr = f"Job exceeded timeout of {JOB_TIMEOUT_SECONDS} seconds."
        final_status = JobStatus.timed_out
    except Exception as exc:
        stderr = f"{type(exc).__name__}: {exc}"
        final_status = JobStatus.failed

    with SessionLocal() as db:
        job = db.get(Job, job_id)
        if not job:
            return
        job.status = final_status
        job.exit_code = exit_code
        job.stdout = stdout
        job.stderr = stderr
        job.finished_at = datetime.now(timezone.utc)
        db.commit()
