"""FastAPI identity provider application entrypoint."""
import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from sqlalchemy import select

from .config import get_settings
from .database import Base, engine, SessionLocal
from .models import User
from .keys import key_manager
from .security import hash_secret
from .deps import render
from .routers import auth, admin, oauth

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("idp")
settings = get_settings()


def _seed_admin() -> None:
    if not (settings.admin_username and settings.admin_password):
        return
    db = SessionLocal()
    try:
        exists = db.execute(
            select(User).where(User.username == settings.admin_username)
        ).scalar_one_or_none()
        if exists:
            return
        db.add(User(
            username=settings.admin_username,
            email=settings.admin_email,
            password_hash=hash_secret(settings.admin_password),
            is_admin=True,
        ))
        db.commit()
        log.info("Seeded admin user '%s'.", settings.admin_username)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    key_manager.load()
    _seed_admin()
    yield


app = FastAPI(title="Identity Provider", lifespan=lifespan, docs_url=None, redoc_url=None)

# Signed, HttpOnly session cookie. Secure flag is enabled in production (HTTPS).
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.session_secret,
    session_cookie="idp_session",
    same_site="lax",
    https_only=settings.cookie_secure,
    max_age=60 * 60 * 8,
)

_static_dir = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=_static_dir), name="static")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; style-src 'self'; "
        "script-src 'self'; object-src 'none'; frame-ancestors 'none'; "
        "base-uri 'none'; form-action 'self'"
    )
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    if settings.cookie_secure:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


# --- Error handling: never leak stack traces or internals to clients. --------
@app.exception_handler(404)
async def not_found_handler(request: Request, exc):
    if request.url.path.startswith(("/oauth", "/userinfo", "/.well-known")):
        return JSONResponse({"error": "not_found"}, status_code=404)
    return render(request, "error.html", {"message": "Page not found."}, status_code=404)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc):
    log.exception("Unhandled error processing %s %s", request.method, request.url.path)
    if request.url.path.startswith(("/oauth", "/userinfo", "/.well-known")):
        return JSONResponse({"error": "server_error"}, status_code=500)
    return render(request, "error.html",
                  {"message": "An unexpected error occurred. Please try again."},
                  status_code=500)


app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(oauth.router)
