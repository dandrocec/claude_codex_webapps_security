"""FastAPI job runner: logged-in users submit commands, the server runs them,
captures output, and shows a job history with status and logs."""

import os
import secrets
from pathlib import Path

from fastapi import Depends, FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware

import database as db
import runner
from security import hash_password, verify_password

BASE_DIR = Path(__file__).parent
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

# A stable secret keeps sessions valid across restarts; override in production.
SESSION_SECRET = os.environ.get("SESSION_SECRET") or secrets.token_hex(32)

app = FastAPI(title="FastAPI Job Runner")
app.add_middleware(SessionMiddleware, secret_key=SESSION_SECRET)


@app.on_event("startup")
def on_startup() -> None:
    db.init_db()
    runner.requeue_orphans()
    # Seed a default admin account on first run so the app is usable immediately.
    if db.count_users() == 0:
        username = os.environ.get("ADMIN_USERNAME", "admin")
        password = os.environ.get("ADMIN_PASSWORD", "admin")
        db.create_user(username, hash_password(password))
        print(f"[startup] created default user '{username}' (password '{password}')")


# --- auth helpers ----------------------------------------------------------

def current_user(request: Request) -> dict | None:
    uid = request.session.get("user_id")
    uname = request.session.get("username")
    if uid is None or uname is None:
        return None
    return {"id": uid, "username": uname}


def require_user(request: Request) -> dict:
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=303, headers={"Location": "/login"})
    return user


# --- routes ----------------------------------------------------------------

@app.get("/login", response_class=HTMLResponse)
def login_form(request: Request):
    if current_user(request):
        return RedirectResponse("/", status_code=303)
    return templates.TemplateResponse("login.html", {"request": request, "error": None})


@app.post("/login")
def login(request: Request, username: str = Form(...), password: str = Form(...)):
    user = db.get_user_by_username(username)
    if user is None or not verify_password(password, user["password_hash"]):
        return templates.TemplateResponse(
            "login.html",
            {"request": request, "error": "Invalid username or password."},
            status_code=401,
        )
    request.session["user_id"] = user["id"]
    request.session["username"] = user["username"]
    return RedirectResponse("/", status_code=303)


@app.post("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login", status_code=303)


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    user = current_user(request)
    if user is None:
        return RedirectResponse("/login", status_code=303)
    jobs = db.list_jobs()
    return templates.TemplateResponse(
        "index.html", {"request": request, "user": user, "jobs": jobs}
    )


@app.post("/jobs")
def submit_job(request: Request, command: str = Form(...)):
    user = require_user(request)
    command = command.strip()
    if not command:
        raise HTTPException(status_code=400, detail="Command must not be empty.")
    job_id = db.create_job(user["id"], user["username"], command)
    runner.submit(job_id)
    return RedirectResponse(f"/jobs/{job_id}", status_code=303)


@app.get("/jobs/{job_id}", response_class=HTMLResponse)
def job_detail(request: Request, job_id: int):
    user = current_user(request)
    if user is None:
        return RedirectResponse("/login", status_code=303)
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return templates.TemplateResponse(
        "job.html", {"request": request, "user": user, "job": job}
    )


@app.get("/api/jobs/{job_id}")
def job_status(request: Request, job_id: int):
    """JSON endpoint used by the detail page to live-poll status and logs."""
    require_user(request)
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return {
        "id": job["id"],
        "status": job["status"],
        "exit_code": job["exit_code"],
        "output": job["output"],
        "finished_at": job["finished_at"],
    }
