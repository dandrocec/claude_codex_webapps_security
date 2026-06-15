"""FastAPI file-upload application with OWASP-aligned hardening."""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import FastAPI, Form, Request, UploadFile, File, Depends, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse, Response, FileResponse
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware
from starlette.status import (
    HTTP_303_SEE_OTHER,
    HTTP_400_BAD_REQUEST,
    HTTP_403_FORBIDDEN,
    HTTP_404_NOT_FOUND,
    HTTP_413_REQUEST_ENTITY_TOO_LARGE,
)

from . import config, db, security

logger = logging.getLogger("uploadapp")

app = FastAPI(title="Secure File Upload", docs_url=None, redoc_url=None)

# Session cookie: HttpOnly is enforced by Starlette; Secure via https_only;
# SameSite=lax mitigates CSRF on top of the explicit token check below.
app.add_middleware(
    SessionMiddleware,
    secret_key=config.SECRET_KEY,
    session_cookie=config.SESSION_COOKIE_NAME,
    max_age=config.SESSION_MAX_AGE,
    same_site="lax",
    https_only=config.COOKIE_SECURE,
)

templates = Jinja2Templates(directory=str(config.BASE_DIR / "app" / "templates"))


@app.on_event("startup")
def _startup() -> None:
    config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    db.init_db()


# --- Security headers -------------------------------------------------------
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    # Strict CSP: no inline scripts, no third-party origins.
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; object-src 'none'; "
        "base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    )
    if config.COOKIE_SECURE:
        response.headers["Strict-Transport-Security"] = (
            "max-age=63072000; includeSubDomains"
        )
    return response


# --- Helpers / dependencies -------------------------------------------------
def get_csrf_token(request: Request) -> str:
    token = request.session.get("csrf_token")
    if not token:
        token = security.generate_csrf_token()
        request.session["csrf_token"] = token
    return token


def require_csrf(request: Request, form_token: Optional[str]) -> None:
    if not security.csrf_tokens_match(request.session.get("csrf_token"), form_token):
        raise HTTPException(status_code=HTTP_403_FORBIDDEN, detail="Invalid CSRF token")


def current_user(request: Request):
    user_id = request.session.get("user_id")
    if not user_id:
        return None
    return db.get_user_by_id(int(user_id))


def require_user(request: Request):
    user = current_user(request)
    if user is None:
        # Signal the caller to redirect to login.
        raise HTTPException(status_code=HTTP_303_SEE_OTHER, headers={"Location": "/login"})
    return user


# --- Error handling (no stack traces / internals leak to clients) -----------
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    if exc.status_code == HTTP_303_SEE_OTHER and "Location" in (exc.headers or {}):
        return RedirectResponse(exc.headers["Location"], status_code=HTTP_303_SEE_OTHER)
    return templates.TemplateResponse(
        "error.html",
        {"request": request, "status": exc.status_code, "message": exc.detail},
        status_code=exc.status_code,
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # Log full detail server-side; return a generic message to the client.
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return templates.TemplateResponse(
        "error.html",
        {"request": request, "status": 500, "message": "An internal error occurred."},
        status_code=500,
    )


# --- Routes -----------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    if current_user(request):
        return RedirectResponse("/files", status_code=HTTP_303_SEE_OTHER)
    return RedirectResponse("/login", status_code=HTTP_303_SEE_OTHER)


@app.get("/register", response_class=HTMLResponse)
def register_form(request: Request):
    return templates.TemplateResponse(
        "register.html", {"request": request, "csrf_token": get_csrf_token(request)}
    )


@app.post("/register")
def register(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    csrf_token: str = Form(...),
):
    require_csrf(request, csrf_token)
    username = username.strip()

    err = security.validate_username(username) or security.validate_password(password)
    if err:
        return templates.TemplateResponse(
            "register.html",
            {"request": request, "error": err, "csrf_token": get_csrf_token(request)},
            status_code=HTTP_400_BAD_REQUEST,
        )

    if db.get_user_by_username(username) is not None:
        return templates.TemplateResponse(
            "register.html",
            {
                "request": request,
                "error": "That username is already taken.",
                "csrf_token": get_csrf_token(request),
            },
            status_code=HTTP_400_BAD_REQUEST,
        )

    user_id = db.create_user(username, security.hash_password(password))
    request.session["user_id"] = user_id
    return RedirectResponse("/files", status_code=HTTP_303_SEE_OTHER)


@app.get("/login", response_class=HTMLResponse)
def login_form(request: Request):
    return templates.TemplateResponse(
        "login.html", {"request": request, "csrf_token": get_csrf_token(request)}
    )


@app.post("/login")
def login(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    csrf_token: str = Form(...),
):
    require_csrf(request, csrf_token)
    username = username.strip()
    user = db.get_user_by_username(username)

    # Same generic message whether the user exists or not (no user enumeration).
    if user is None or not security.verify_password(user["password_hash"], password):
        return templates.TemplateResponse(
            "login.html",
            {
                "request": request,
                "error": "Invalid username or password.",
                "csrf_token": get_csrf_token(request),
            },
            status_code=HTTP_400_BAD_REQUEST,
        )

    # Rotate session identifier on privilege change (prevents session fixation).
    request.session.clear()
    request.session["user_id"] = int(user["id"])
    request.session["csrf_token"] = security.generate_csrf_token()
    return RedirectResponse("/files", status_code=HTTP_303_SEE_OTHER)


@app.post("/logout")
def logout(request: Request, csrf_token: str = Form(...)):
    require_csrf(request, csrf_token)
    request.session.clear()
    return RedirectResponse("/login", status_code=HTTP_303_SEE_OTHER)


@app.get("/files", response_class=HTMLResponse)
def list_files(request: Request, user=Depends(require_user)):
    files = db.list_files_for_owner(int(user["id"]))
    return templates.TemplateResponse(
        "files.html",
        {
            "request": request,
            "user": user,
            "files": files,
            "csrf_token": get_csrf_token(request),
        },
    )


@app.get("/upload", response_class=HTMLResponse)
def upload_form(request: Request, user=Depends(require_user)):
    return templates.TemplateResponse(
        "upload.html",
        {
            "request": request,
            "user": user,
            "csrf_token": get_csrf_token(request),
            "max_mb": round(config.MAX_UPLOAD_BYTES / (1024 * 1024), 1),
            "allowed": ", ".join(sorted(config.ALLOWED_TYPES)),
        },
    )


@app.post("/upload")
async def upload(
    request: Request,
    user=Depends(require_user),
    file: UploadFile = File(...),
    csrf_token: str = Form(...),
):
    require_csrf(request, csrf_token)

    # Stream the upload while enforcing the size limit, so an oversized file is
    # rejected without being fully buffered in memory.
    data = bytearray()
    chunk_size = 64 * 1024
    while True:
        chunk = await file.read(chunk_size)
        if not chunk:
            break
        data.extend(chunk)
        if len(data) > config.MAX_UPLOAD_BYTES:
            return _upload_error(
                request, user,
                f"File exceeds the maximum size of "
                f"{round(config.MAX_UPLOAD_BYTES / (1024*1024), 1)} MB.",
                HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            )
    data = bytes(data)

    if not data:
        return _upload_error(request, user, "The uploaded file is empty.")

    # Validate by inspected content, not by filename or Content-Type.
    filetype = security.sniff_filetype(data)
    if filetype is None or filetype not in config.ALLOWED_TYPES:
        return _upload_error(
            request, user,
            "File type not allowed. Permitted types: "
            + ", ".join(sorted(config.ALLOWED_TYPES)) + ".",
        )

    # Server-generated random name; the original name is stored only as a label.
    stored_name = security.random_stored_name(filetype)
    dest = (config.UPLOAD_DIR / stored_name).resolve()
    # Defense-in-depth: ensure the resolved path stays inside UPLOAD_DIR.
    if config.UPLOAD_DIR not in dest.parents:
        raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail="Invalid path")

    with open(dest, "wb") as fh:
        fh.write(data)

    db.add_file(
        owner_id=int(user["id"]),
        stored_name=stored_name,
        original_name=(file.filename or "upload")[:255],
        content_type=config.ALLOWED_TYPES[filetype],
        size=len(data),
    )
    return RedirectResponse("/files", status_code=HTTP_303_SEE_OTHER)


@app.get("/download/{file_id}")
def download(request: Request, file_id: int, user=Depends(require_user)):
    # Access control: the query is scoped to the owner, so one user can never
    # download another user's file (prevents IDOR).
    record = db.get_file_for_owner(file_id, int(user["id"]))
    if record is None:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="File not found")

    path = (config.UPLOAD_DIR / record["stored_name"]).resolve()
    if config.UPLOAD_DIR not in path.parents or not path.is_file():
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="File not found")

    # Force download as an attachment with a fixed content type; never serve
    # uploads as executable/inline HTML.
    safe_name = _safe_download_name(record["original_name"])
    return FileResponse(
        path,
        media_type="application/octet-stream",
        filename=safe_name,
        headers={"X-Content-Type-Options": "nosniff"},
    )


def _safe_download_name(name: str) -> str:
    # Strip path separators and control chars from the suggested download name.
    cleaned = "".join(c for c in name if c.isprintable() and c not in '/\\"')
    cleaned = cleaned.replace("\r", "").replace("\n", "").strip()
    return cleaned or "download"


def _upload_error(request, user, message: str, status: int = HTTP_400_BAD_REQUEST):
    return templates.TemplateResponse(
        "upload.html",
        {
            "request": request,
            "user": user,
            "error": message,
            "csrf_token": get_csrf_token(request),
            "max_mb": round(config.MAX_UPLOAD_BYTES / (1024 * 1024), 1),
            "allowed": ", ".join(sorted(config.ALLOWED_TYPES)),
        },
        status_code=status,
    )
