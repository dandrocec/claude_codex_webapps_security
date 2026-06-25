import html
import os
import secrets
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile, status
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.exceptions import RequestValidationError
from itsdangerous import BadSignature, URLSafeSerializer
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.sessions import SessionMiddleware

BASE_DIR = Path(__file__).resolve().parent.parent
DATABASE_PATH = Path(os.environ.get("DATABASE_PATH", BASE_DIR / "app.db")).resolve()
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", BASE_DIR / "uploads")).resolve()
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(5 * 1024 * 1024)))
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "true").lower() not in {"0", "false", "no"}
APP_SECRET_KEY = os.environ.get("APP_SECRET_KEY")

if not APP_SECRET_KEY:
    raise RuntimeError("APP_SECRET_KEY environment variable is required")

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(debug=False)
app.add_middleware(
    SessionMiddleware,
    secret_key=APP_SECRET_KEY,
    session_cookie="fileapp_session",
    https_only=COOKIE_SECURE,
    same_site="lax",
    max_age=60 * 60 * 8,
)

password_hasher = PasswordHasher()
csrf_serializer = URLSafeSerializer(APP_SECRET_KEY, salt="csrf-token")

ALLOWED_TYPES = {
    "png": {"mime": "image/png", "ext": ".png"},
    "jpeg": {"mime": "image/jpeg", "ext": ".jpg"},
    "gif": {"mime": "image/gif", "ext": ".gif"},
    "pdf": {"mime": "application/pdf", "ext": ".pdf"},
    "txt": {"mime": "text/plain; charset=utf-8", "ext": ".txt"},
}


@contextmanager
def db_connection():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with db_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS uploads (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                original_name TEXT NOT NULL,
                stored_name TEXT NOT NULL UNIQUE,
                content_type TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = "default-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Cache-Control"] = "no-store"
    if COOKIE_SECURE:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    return HTMLResponse(render_page("Error", "<p>Something went wrong.</p>"), status_code=500)


@app.exception_handler(StarletteHTTPException)
async def custom_http_exception_handler(request: Request, exc: StarletteHTTPException):
    if exc.status_code in {status.HTTP_303_SEE_OTHER, status.HTTP_307_TEMPORARY_REDIRECT}:
        return await http_exception_handler(request, exc)
    message = "The requested action could not be completed."
    if exc.status_code == status.HTTP_404_NOT_FOUND:
        message = "The requested resource was not found."
    if exc.status_code == status.HTTP_403_FORBIDDEN:
        message = "You are not allowed to access that resource."
    if exc.status_code == status.HTTP_401_UNAUTHORIZED:
        message = "Please sign in to continue."
    return HTMLResponse(render_page("Error", f"<p>{html.escape(message)}</p>"), status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return HTMLResponse(render_page("Error", "<p>The submitted request was invalid.</p>"), status_code=400)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def validate_username(username: str) -> str:
    username = username.strip()
    if not 3 <= len(username) <= 40:
        raise HTTPException(status_code=400, detail="Invalid username")
    if not all(ch.isalnum() or ch in {"_", "-"} for ch in username):
        raise HTTPException(status_code=400, detail="Invalid username")
    return username


def validate_password(password: str) -> str:
    if len(password) < 12 or len(password) > 256:
        raise HTTPException(status_code=400, detail="Invalid password")
    return password


def current_user(request: Request):
    user_id = request.session.get("user_id")
    if not isinstance(user_id, int):
        return None
    with db_connection() as conn:
        return conn.execute("SELECT id, username FROM users WHERE id = ?", (user_id,)).fetchone()


def require_user(request: Request):
    user = current_user(request)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return user


def csrf_token(request: Request) -> str:
    session_token = request.session.get("csrf_nonce")
    if not session_token:
        session_token = secrets.token_urlsafe(32)
        request.session["csrf_nonce"] = session_token
    return csrf_serializer.dumps(session_token)


def verify_csrf(request: Request, token: str) -> None:
    session_token = request.session.get("csrf_nonce")
    if not session_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
    try:
        submitted = csrf_serializer.loads(token)
    except BadSignature as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN) from exc
    if not secrets.compare_digest(str(submitted), str(session_token)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)


def render_page(title: str, body: str, user=None) -> str:
    username = html.escape(user["username"]) if user else ""
    auth_links = (
        f'<span>Signed in as {username}</span>'
        '<form method="post" action="/logout" class="inline"><input type="hidden" name="csrf_token" value="{{csrf}}">'
        '<button type="submit">Sign out</button></form>'
        if user
        else '<a href="/login">Sign in</a> <a href="/register">Register</a>'
    )
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)}</title>
  <style>
    body {{ font-family: system-ui, sans-serif; margin: 0; background: #f7f7f5; color: #202124; }}
    header, main {{ max-width: 820px; margin: 0 auto; padding: 24px; }}
    header {{ display: flex; justify-content: space-between; align-items: center; gap: 16px; }}
    nav {{ display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }}
    a {{ color: #075985; }}
    .panel {{ background: white; border: 1px solid #ddd; border-radius: 8px; padding: 20px; }}
    label {{ display: block; margin-top: 14px; font-weight: 650; }}
    input {{ box-sizing: border-box; width: 100%; padding: 10px; margin-top: 6px; }}
    button {{ margin-top: 16px; padding: 10px 14px; border: 0; border-radius: 6px; background: #166534; color: white; cursor: pointer; }}
    .inline {{ display: inline; }}
    .inline button {{ margin: 0; background: #444; }}
    li {{ margin: 10px 0; }}
    .muted {{ color: #666; }}
  </style>
</head>
<body>
  <header>
    <strong><a href="/">Secure Uploads</a></strong>
    <nav>{auth_links}</nav>
  </header>
  <main><section class="panel">{body}</section></main>
</body>
</html>"""


def page_response(request: Request, title: str, body: str, user=None) -> HTMLResponse:
    rendered = render_page(title, body, user).replace("{{csrf}}", html.escape(csrf_token(request), quote=True))
    return HTMLResponse(rendered)


@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    user = current_user(request)
    if not user:
        return RedirectResponse("/login", status_code=status.HTTP_303_SEE_OTHER)
    body = f"""
      <h1>Upload a File</h1>
      <p class="muted">Allowed: PNG, JPEG, GIF, PDF, and UTF-8 text. Maximum size: {MAX_UPLOAD_BYTES} bytes.</p>
      <form method="post" action="/upload" enctype="multipart/form-data">
        <input type="hidden" name="csrf_token" value="{{csrf}}">
        <label for="file">File</label>
        <input id="file" name="file" type="file" required>
        <button type="submit">Upload</button>
      </form>
      <p><a href="/files">View uploaded files</a></p>
    """
    return page_response(request, "Upload", body, user)


@app.get("/register", response_class=HTMLResponse)
def register_form(request: Request):
    body = """
      <h1>Register</h1>
      <form method="post" action="/register">
        <input type="hidden" name="csrf_token" value="{{csrf}}">
        <label for="username">Username</label>
        <input id="username" name="username" autocomplete="username" required minlength="3" maxlength="40">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="new-password" required minlength="12">
        <button type="submit">Create account</button>
      </form>
    """
    return page_response(request, "Register", body)


@app.post("/register")
def register(request: Request, csrf_token_value: Annotated[str, Form(alias="csrf_token")], username: Annotated[str, Form()], password: Annotated[str, Form()]):
    verify_csrf(request, csrf_token_value)
    username = validate_username(username)
    password = validate_password(password)
    password_hash = password_hasher.hash(password)
    try:
        with db_connection() as conn:
            cursor = conn.execute(
                "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
                (username, password_hash, now_iso()),
            )
            request.session.clear()
            request.session["user_id"] = cursor.lastrowid
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=400, detail="Username already exists") from exc
    return RedirectResponse("/", status_code=status.HTTP_303_SEE_OTHER)


@app.get("/login", response_class=HTMLResponse)
def login_form(request: Request):
    body = """
      <h1>Sign in</h1>
      <form method="post" action="/login">
        <input type="hidden" name="csrf_token" value="{{csrf}}">
        <label for="username">Username</label>
        <input id="username" name="username" autocomplete="username" required>
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required>
        <button type="submit">Sign in</button>
      </form>
      <p><a href="/register">Create an account</a></p>
    """
    return page_response(request, "Sign in", body)


@app.post("/login")
def login(request: Request, csrf_token_value: Annotated[str, Form(alias="csrf_token")], username: Annotated[str, Form()], password: Annotated[str, Form()]):
    verify_csrf(request, csrf_token_value)
    username = validate_username(username)
    with db_connection() as conn:
        user = conn.execute("SELECT id, password_hash FROM users WHERE username = ?", (username,)).fetchone()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    try:
        password_hasher.verify(user["password_hash"], password)
    except (VerifyMismatchError, VerificationError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED) from exc
    request.session.clear()
    request.session["user_id"] = int(user["id"])
    request.session["csrf_nonce"] = secrets.token_urlsafe(32)
    return RedirectResponse("/", status_code=status.HTTP_303_SEE_OTHER)


@app.post("/logout")
def logout(request: Request, csrf_token_value: Annotated[str, Form(alias="csrf_token")]):
    verify_csrf(request, csrf_token_value)
    request.session.clear()
    return RedirectResponse("/login", status_code=status.HTTP_303_SEE_OTHER)


def detect_file_type(data: bytes):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ALLOWED_TYPES["png"]
    if data.startswith(b"\xff\xd8\xff"):
        return ALLOWED_TYPES["jpeg"]
    if data.startswith((b"GIF87a", b"GIF89a")):
        return ALLOWED_TYPES["gif"]
    if data.startswith(b"%PDF-"):
        return ALLOWED_TYPES["pdf"]
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return None
    if "\x00" in text:
        return None
    return ALLOWED_TYPES["txt"]


def safe_upload_path(stored_name: str) -> Path:
    candidate = (UPLOAD_DIR / stored_name).resolve()
    if UPLOAD_DIR not in candidate.parents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST)
    return candidate


@app.post("/upload")
async def upload_file(
    request: Request,
    csrf_token_value: Annotated[str, Form(alias="csrf_token")],
    file: Annotated[UploadFile, File()],
    user=Depends(require_user),
):
    verify_csrf(request, csrf_token_value)
    original_name = Path(file.filename or "upload").name[:180]
    if not original_name:
        original_name = "upload"

    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File too large")
    if not content:
        raise HTTPException(status_code=400, detail="Empty files are not allowed")

    detected = detect_file_type(content)
    if not detected:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    file_id = str(uuid.uuid4())
    stored_name = f"{secrets.token_urlsafe(24)}{detected['ext']}"
    destination = safe_upload_path(stored_name)
    destination.write_bytes(content)

    with db_connection() as conn:
        conn.execute(
            """
            INSERT INTO uploads (id, user_id, original_name, stored_name, content_type, size_bytes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (file_id, int(user["id"]), original_name, stored_name, detected["mime"], len(content), now_iso()),
        )
    return RedirectResponse("/files", status_code=status.HTTP_303_SEE_OTHER)


@app.get("/files", response_class=HTMLResponse)
def list_files(request: Request, user=Depends(require_user)):
    with db_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, original_name, content_type, size_bytes, created_at
            FROM uploads
            WHERE user_id = ?
            ORDER BY created_at DESC
            """,
            (int(user["id"]),),
        ).fetchall()
    if rows:
        items = "\n".join(
            "<li>"
            f'<a href="/files/{html.escape(row["id"], quote=True)}/download">{html.escape(row["original_name"])}</a>'
            f' <span class="muted">({html.escape(row["content_type"])}, {int(row["size_bytes"])} bytes)</span>'
            "</li>"
            for row in rows
        )
        body = f"<h1>Your Files</h1><ul>{items}</ul><p><a href=\"/\">Upload another file</a></p>"
    else:
        body = '<h1>Your Files</h1><p>No files uploaded yet.</p><p><a href="/">Upload a file</a></p>'
    return page_response(request, "Your files", body, user)


@app.get("/files/{file_id}/download")
def download_file(file_id: str, user=Depends(require_user)):
    try:
        uuid.UUID(file_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND) from exc
    with db_connection() as conn:
        row = conn.execute(
            """
            SELECT original_name, stored_name, content_type
            FROM uploads
            WHERE id = ? AND user_id = ?
            """,
            (file_id, int(user["id"])),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    path = safe_upload_path(row["stored_name"])
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return FileResponse(
        path,
        media_type=row["content_type"],
        filename=Path(row["original_name"]).name,
        headers={"X-Content-Type-Options": "nosniff"},
    )
