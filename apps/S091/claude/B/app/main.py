"""FastAPI application factory: middleware, security headers, error handling."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import settings
from .database import SessionLocal, init_db
from .models import Session as SessionModel
from .security import new_token
from .services import ServiceError
from .tasks import start_worker_thread

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("microblog")

_worker_handle: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    if settings.WORKER_ENABLED:
        thread, stop_event = start_worker_thread()
        _worker_handle["thread"] = thread
        _worker_handle["stop"] = stop_event
        logger.info("in-process worker started")
    yield
    stop_event = _worker_handle.get("stop")
    if stop_event is not None:
        stop_event.set()


app = FastAPI(
    title="Microblog",
    lifespan=lifespan,
    docs_url="/api/docs" if settings.DEBUG else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if settings.DEBUG else None,
)


# --------------------------------------------------------------------------- #
# Session middleware: ensure every visitor has a server-side session + CSRF
# token. The cookie only carries an opaque random token.
# --------------------------------------------------------------------------- #
@app.middleware("http")
async def session_middleware(request: Request, call_next):
    db = SessionLocal()
    cookie_to_set: str | None = None
    try:
        now = datetime.utcnow()
        token = request.cookies.get(settings.COOKIE_NAME)
        session = None
        if token:
            session = db.query(SessionModel).filter(SessionModel.token == token).first()
            if session and session.expires_at < now:
                db.delete(session)
                db.commit()
                session = None

        if session is None:
            session = SessionModel(
                token=new_token(),
                csrf_token=new_token(),
                expires_at=now + timedelta(hours=settings.SESSION_TTL_HOURS),
            )
            db.add(session)
            db.commit()
            cookie_to_set = session.token

        request.state.session_token = session.token
        request.state.csrf_token = session.csrf_token
    finally:
        db.close()

    response = await call_next(request)

    if cookie_to_set is not None:
        response.set_cookie(
            key=settings.COOKIE_NAME,
            value=cookie_to_set,
            max_age=settings.SESSION_TTL_HOURS * 3600,
            httponly=True,
            secure=settings.COOKIE_SECURE,
            samesite=settings.COOKIE_SAMESITE,
            path="/",
        )
    return response


# --------------------------------------------------------------------------- #
# Security headers on every response.
# --------------------------------------------------------------------------- #
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    csp = (
        "default-src 'self'; "
        "img-src 'self' data:; "
        "style-src 'self'; "
        "script-src 'self'; "
        "object-src 'none'; "
        "base-uri 'none'; "
        "frame-ancestors 'none'; "
        "form-action 'self'"
    )
    response.headers["Content-Security-Policy"] = csp
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    if settings.COOKIE_SECURE:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


# --------------------------------------------------------------------------- #
# Error handling: never leak stack traces or internal details to clients.
# --------------------------------------------------------------------------- #
def _wants_json(request: Request) -> bool:
    if request.url.path.startswith("/api"):
        return True
    accept = request.headers.get("accept", "")
    return "application/json" in accept and "text/html" not in accept


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    if _wants_json(request):
        return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})
    if exc.status_code == status.HTTP_401_UNAUTHORIZED:
        return RedirectResponse(url="/login", status_code=status.HTTP_303_SEE_OTHER)
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})


@app.exception_handler(ServiceError)
async def service_error_handler(request: Request, exc: ServiceError):
    if _wants_json(request):
        return JSONResponse(status_code=exc.status_code, content={"error": exc.message})
    # For the HTML UI, send the user back to a SAME-ORIGIN path only (no open
    # redirect): take just the path component of the Referer.
    referer = request.headers.get("referer", "/")
    path = urlparse(referer).path or "/"
    if not path.startswith("/"):
        path = "/"
    sep = "&" if "?" in path else "?"
    return RedirectResponse(
        url=f"{path}{sep}error={exc.status_code}", status_code=status.HTTP_303_SEE_OTHER
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    # Surface which fields failed, but not internal structure.
    errors = [{"field": ".".join(str(p) for p in e["loc"][1:]), "message": e["msg"]} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"error": "Validation failed", "details": errors})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    detail = str(exc) if settings.DEBUG else "Internal server error"
    return JSONResponse(status_code=500, content={"error": detail})


# Mount static files and routers. Use module-relative paths so the app works
# regardless of the current working directory.
_STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")

from .routes import api as api_routes  # noqa: E402
from .routes import web as web_routes  # noqa: E402

app.include_router(api_routes.router)
app.include_router(web_routes.router)
