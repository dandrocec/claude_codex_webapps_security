"""FastAPI identity provider: OAuth2 / OpenID-Connect authorization-code flow.

Endpoints
---------
GET  /authorize                     Start login + consent, issue an auth code.
POST /login                         Submit credentials (used by /authorize).
POST /token                         Exchange an auth code for signed tokens.
GET  /userinfo                      Return claims for a valid access token.
GET  /.well-known/jwks.json         Public keys for verifying tokens.
GET  /.well-known/openid-configuration   Discovery document.
GET/POST /admin/...                 Manage client applications.
"""
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from fastapi import Depends, FastAPI, Form, HTTPException, Request, status
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from starlette.middleware.sessions import SessionMiddleware

from .config import BASE_DIR, settings
from .database import get_db
from .models import AuthorizationCode, Client, User, generate_token
from .security import (
    decode_token,
    hash_password,
    issue_token,
    jwks,
    verify_password,
)
from .seed import init_db

app = FastAPI(title="FastAPI Identity Provider", version="1.0.0")
app.add_middleware(SessionMiddleware, secret_key=settings.session_secret)
templates = Jinja2Templates(directory=str(BASE_DIR / "app" / "templates"))


@app.on_event("startup")
def on_startup() -> None:
    init_db()


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _now() -> datetime:
    return datetime.now(timezone.utc)


def current_user(request: Request, db: Session) -> User | None:
    user_id = request.session.get("user_id")
    if not user_id:
        return None
    return db.get(User, user_id)


def require_admin(request: Request, db: Session = Depends(get_db)) -> User:
    user = current_user(request, db)
    if user is None or not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_303_SEE_OTHER,
            headers={"Location": "/admin/login"},
        )
    return user


def user_claims(user: User, scope: str) -> dict:
    scopes = set(scope.split())
    claims: dict = {}
    if "profile" in scopes:
        claims["name"] = user.full_name or user.username
        claims["preferred_username"] = user.username
    if "email" in scopes:
        claims["email"] = user.email
    return claims


# --------------------------------------------------------------------------- #
# Discovery / keys
# --------------------------------------------------------------------------- #
@app.get("/.well-known/openid-configuration")
def discovery() -> JSONResponse:
    base = settings.issuer.rstrip("/")
    return JSONResponse(
        {
            "issuer": settings.issuer,
            "authorization_endpoint": f"{base}/authorize",
            "token_endpoint": f"{base}/token",
            "userinfo_endpoint": f"{base}/userinfo",
            "jwks_uri": f"{base}/.well-known/jwks.json",
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code"],
            "subject_types_supported": ["public"],
            "id_token_signing_alg_values_supported": ["RS256"],
            "scopes_supported": ["openid", "profile", "email"],
            "token_endpoint_auth_methods_supported": ["client_secret_post"],
        }
    )


@app.get("/.well-known/jwks.json")
def jwks_endpoint() -> JSONResponse:
    return JSONResponse(jwks())


# --------------------------------------------------------------------------- #
# Authorization-code flow
# --------------------------------------------------------------------------- #
@app.get("/authorize", response_class=HTMLResponse)
def authorize(
    request: Request,
    client_id: str,
    redirect_uri: str,
    response_type: str = "code",
    scope: str = "openid profile email",
    state: str | None = None,
    nonce: str | None = None,
    db: Session = Depends(get_db),
):
    if response_type != "code":
        raise HTTPException(400, "Only response_type=code is supported")

    client = db.query(Client).filter(Client.client_id == client_id, Client.is_active).first()
    if client is None:
        raise HTTPException(400, "Unknown or inactive client_id")
    if not client.allows_redirect(redirect_uri):
        raise HTTPException(400, "redirect_uri is not registered for this client")

    user = current_user(request, db)
    if user is None:
        # Show the login form; the hidden fields carry the request forward.
        return templates.TemplateResponse(
            "login.html",
            {
                "request": request,
                "client": client,
                "scope": scope,
                "redirect_uri": redirect_uri,
                "state": state or "",
                "nonce": nonce or "",
                "error": None,
            },
        )

    return _issue_code_and_redirect(db, user, client, redirect_uri, scope, state, nonce)


@app.post("/login")
def login(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    client_id: str = Form(...),
    redirect_uri: str = Form(...),
    scope: str = Form("openid profile email"),
    state: str = Form(""),
    nonce: str = Form(""),
    db: Session = Depends(get_db),
):
    client = db.query(Client).filter(Client.client_id == client_id, Client.is_active).first()
    if client is None or not client.allows_redirect(redirect_uri):
        raise HTTPException(400, "Invalid client or redirect_uri")

    user = db.query(User).filter(User.username == username, User.is_active).first()
    if user is None or not verify_password(password, user.hashed_password):
        return templates.TemplateResponse(
            "login.html",
            {
                "request": request,
                "client": client,
                "scope": scope,
                "redirect_uri": redirect_uri,
                "state": state,
                "nonce": nonce,
                "error": "Invalid username or password",
            },
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    request.session["user_id"] = user.id
    return _issue_code_and_redirect(db, user, client, redirect_uri, scope, state or None, nonce or None)


def _issue_code_and_redirect(
    db: Session,
    user: User,
    client: Client,
    redirect_uri: str,
    scope: str,
    state: str | None,
    nonce: str | None,
) -> RedirectResponse:
    code = AuthorizationCode(
        code=generate_token(),
        client_id=client.client_id,
        user_id=user.id,
        redirect_uri=redirect_uri,
        scope=scope,
        nonce=nonce,
        expires_at=_now() + timedelta(seconds=settings.auth_code_ttl),
    )
    db.add(code)
    db.commit()

    params = {"code": code.code}
    if state:
        params["state"] = state
    return RedirectResponse(
        url=f"{redirect_uri}?{urlencode(params)}",
        status_code=status.HTTP_303_SEE_OTHER,
    )


@app.post("/token")
def token(
    grant_type: str = Form(...),
    code: str = Form(...),
    redirect_uri: str = Form(...),
    client_id: str = Form(...),
    client_secret: str = Form(...),
    db: Session = Depends(get_db),
):
    if grant_type != "authorization_code":
        raise HTTPException(400, detail={"error": "unsupported_grant_type"})

    client = db.query(Client).filter(Client.client_id == client_id, Client.is_active).first()
    if client is None or client.client_secret != client_secret:
        raise HTTPException(401, detail={"error": "invalid_client"})

    auth_code = db.query(AuthorizationCode).filter(AuthorizationCode.code == code).first()
    if auth_code is None or not auth_code.is_valid():
        raise HTTPException(400, detail={"error": "invalid_grant"})
    if auth_code.client_id != client_id or auth_code.redirect_uri != redirect_uri:
        raise HTTPException(400, detail={"error": "invalid_grant"})

    # One-time use.
    auth_code.used = True
    db.commit()

    user = db.get(User, auth_code.user_id)
    sub = str(user.id)

    access_token = issue_token(
        subject=sub,
        audience=client.client_id,
        ttl=settings.access_token_ttl,
        extra_claims={"scope": auth_code.scope, "token_use": "access"},
    )
    id_claims = user_claims(user, auth_code.scope)
    if auth_code.nonce:
        id_claims["nonce"] = auth_code.nonce
    id_token = issue_token(
        subject=sub,
        audience=client.client_id,
        ttl=settings.id_token_ttl,
        extra_claims={**id_claims, "token_use": "id"},
    )

    return JSONResponse(
        {
            "access_token": access_token,
            "id_token": id_token,
            "token_type": "Bearer",
            "expires_in": settings.access_token_ttl,
            "scope": auth_code.scope,
        }
    )


@app.get("/userinfo")
def userinfo(request: Request, db: Session = Depends(get_db)):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing bearer token", headers={"WWW-Authenticate": "Bearer"})
    token_str = auth.removeprefix("Bearer ").strip()

    try:
        payload = decode_token(token_str)  # signature + iss + exp verified
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(401, f"Invalid token: {exc}", headers={"WWW-Authenticate": "Bearer"})

    user = db.get(User, int(payload["sub"]))
    if user is None or not user.is_active:
        raise HTTPException(401, "User no longer exists")

    claims = {"sub": payload["sub"]}
    claims.update(user_claims(user, payload.get("scope", "")))
    return JSONResponse(claims)


# --------------------------------------------------------------------------- #
# Admin: manage client applications
# --------------------------------------------------------------------------- #
@app.get("/admin/login", response_class=HTMLResponse)
def admin_login_form(request: Request, error: str | None = None):
    return templates.TemplateResponse(
        "admin_login.html", {"request": request, "error": error}
    )


@app.post("/admin/login")
def admin_login(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.username == username, User.is_active).first()
    if user is None or not user.is_admin or not verify_password(password, user.hashed_password):
        return templates.TemplateResponse(
            "admin_login.html",
            {"request": request, "error": "Invalid admin credentials"},
            status_code=status.HTTP_401_UNAUTHORIZED,
        )
    request.session["user_id"] = user.id
    return RedirectResponse("/admin/clients", status_code=status.HTTP_303_SEE_OTHER)


@app.get("/admin/logout")
def admin_logout(request: Request):
    request.session.clear()
    return RedirectResponse("/admin/login", status_code=status.HTTP_303_SEE_OTHER)


@app.get("/admin/clients", response_class=HTMLResponse)
def admin_clients(
    request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)
):
    clients = db.query(Client).order_by(Client.created_at.desc()).all()
    return templates.TemplateResponse(
        "admin_clients.html",
        {"request": request, "clients": clients, "admin": admin, "issuer": settings.issuer},
    )


@app.post("/admin/clients")
def admin_create_client(
    request: Request,
    name: str = Form(...),
    redirect_uris: str = Form(...),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    client = Client(
        client_id=generate_token(12),
        client_secret=generate_token(24),
        name=name.strip(),
        redirect_uris=" ".join(redirect_uris.split()),
    )
    db.add(client)
    db.commit()
    return RedirectResponse("/admin/clients", status_code=status.HTTP_303_SEE_OTHER)


@app.post("/admin/clients/{client_id}/delete")
def admin_delete_client(
    client_id: str,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    client = db.query(Client).filter(Client.client_id == client_id).first()
    if client:
        db.delete(client)
        db.commit()
    return RedirectResponse("/admin/clients", status_code=status.HTTP_303_SEE_OTHER)


@app.get("/")
def root():
    return RedirectResponse("/admin/login", status_code=status.HTTP_303_SEE_OTHER)
