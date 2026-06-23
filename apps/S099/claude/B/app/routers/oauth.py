"""OAuth 2.0 / OIDC endpoints: authorize, token, userinfo, discovery, JWKS."""
import time
import hashlib
import base64
import secrets
from datetime import timedelta

from fastapi import APIRouter, Request, Depends, Form, status
from fastapi.responses import RedirectResponse, JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, Client, AuthorizationCode, utcnow
from ..deps import get_current_user, render
from ..config import get_settings
from ..keys import key_manager
from ..security import verify_secret
from ..csrf import validate_csrf

router = APIRouter()
settings = get_settings()

SUPPORTED_SCOPES = {"openid", "profile", "email"}


def _oauth_error(error: str, description: str, status_code: int = 400) -> JSONResponse:
    resp = JSONResponse({"error": error, "error_description": description}, status_code=status_code)
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["Pragma"] = "no-cache"
    return resp


def _load_client(db: Session, client_id: str) -> Client | None:
    if not client_id:
        return None
    return db.execute(
        select(Client).where(Client.client_id == client_id)
    ).scalar_one_or_none()


# ---------------------------------------------------------------------------
# Discovery / JWKS
# ---------------------------------------------------------------------------
@router.get("/.well-known/openid-configuration")
def discovery():
    iss = settings.issuer
    return {
        "issuer": iss,
        "authorization_endpoint": f"{iss}/oauth/authorize",
        "token_endpoint": f"{iss}/oauth/token",
        "userinfo_endpoint": f"{iss}/userinfo",
        "jwks_uri": f"{iss}/.well-known/jwks.json",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code"],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["RS256"],
        "token_endpoint_auth_methods_supported": ["client_secret_post"],
        "scopes_supported": sorted(SUPPORTED_SCOPES),
        "code_challenge_methods_supported": ["S256"],
    }


@router.get("/.well-known/jwks.json")
def jwks():
    return key_manager.jwks()


# ---------------------------------------------------------------------------
# Authorization endpoint (authorization code flow)
# ---------------------------------------------------------------------------
def _validate_authorize_params(db: Session, params) -> tuple[Client | None, str | None]:
    client = _load_client(db, params.get("client_id", ""))
    if client is None:
        return None, "Unknown client_id."
    redirect_uri = params.get("redirect_uri", "")
    if redirect_uri not in client.redirect_uri_list():
        # Never redirect to an unregistered URI (open-redirect protection).
        return None, "redirect_uri is not registered for this client."
    if params.get("response_type") != "code":
        return None, "Only response_type=code is supported."
    scope = params.get("scope", "openid")
    if not SUPPORTED_SCOPES.issuperset(scope.split()):
        return None, "Unsupported scope requested."
    method = params.get("code_challenge_method", "")
    if method and method != "S256":
        return None, "Only S256 code_challenge_method is supported."
    return client, None


@router.get("/oauth/authorize")
def authorize_form(request: Request, db: Session = Depends(get_db),
                   user: User | None = Depends(get_current_user)):
    params = dict(request.query_params)
    client, error = _validate_authorize_params(db, params)
    if error:
        return render(request, "error.html",
                      {"message": error, "current_user": user}, status_code=400)

    if user is None:
        nxt = "/oauth/authorize?" + request.url.query
        return RedirectResponse(f"/login?next={_url_quote(nxt)}",
                                status_code=status.HTTP_303_SEE_OTHER)

    return render(request, "authorize.html", {
        "current_user": user,
        "client": client,
        "scope": params.get("scope", "openid"),
        "params": {
            "client_id": params.get("client_id", ""),
            "redirect_uri": params.get("redirect_uri", ""),
            "response_type": "code",
            "scope": params.get("scope", "openid"),
            "state": params.get("state", ""),
            "nonce": params.get("nonce", ""),
            "code_challenge": params.get("code_challenge", ""),
            "code_challenge_method": params.get("code_challenge_method", ""),
        },
    })


@router.post("/oauth/authorize")
def authorize_decision(
    request: Request,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user),
    csrf_token: str = Form(""),
    decision: str = Form(""),
    client_id: str = Form(""),
    redirect_uri: str = Form(""),
    response_type: str = Form("code"),
    scope: str = Form("openid"),
    state: str = Form(""),
    nonce: str = Form(""),
    code_challenge: str = Form(""),
    code_challenge_method: str = Form(""),
):
    if user is None:
        return RedirectResponse("/login", status_code=status.HTTP_303_SEE_OTHER)

    if not validate_csrf(request, csrf_token):
        return render(request, "error.html",
                      {"message": "Invalid or expired form token.", "current_user": user},
                      status_code=400)

    params = {
        "client_id": client_id, "redirect_uri": redirect_uri,
        "response_type": response_type, "scope": scope,
        "code_challenge": code_challenge, "code_challenge_method": code_challenge_method,
    }
    client, error = _validate_authorize_params(db, params)
    if error:
        return render(request, "error.html",
                      {"message": error, "current_user": user}, status_code=400)

    if decision != "allow":
        return _redirect_back(redirect_uri, {"error": "access_denied", "state": state})

    code = secrets.token_urlsafe(32)
    db.add(AuthorizationCode(
        code=code,
        client_id=client_id,
        user_id=user.id,
        redirect_uri=redirect_uri,
        scope=scope,
        nonce=nonce,
        code_challenge=code_challenge,
        code_challenge_method=code_challenge_method,
        expires_at=utcnow() + timedelta(seconds=settings.auth_code_ttl),
    ))
    db.commit()

    result = {"code": code}
    if state:
        result["state"] = state
    return _redirect_back(redirect_uri, result)


# ---------------------------------------------------------------------------
# Token endpoint
# ---------------------------------------------------------------------------
@router.post("/oauth/token")
def token(
    db: Session = Depends(get_db),
    grant_type: str = Form(""),
    code: str = Form(""),
    redirect_uri: str = Form(""),
    client_id: str = Form(""),
    client_secret: str = Form(""),
    code_verifier: str = Form(""),
):
    if grant_type != "authorization_code":
        return _oauth_error("unsupported_grant_type", "Only authorization_code is supported.")

    client = _load_client(db, client_id)
    if client is None or not verify_secret(client.client_secret_hash, client_secret or ""):
        return _oauth_error("invalid_client", "Client authentication failed.", 401)

    auth_code = db.get(AuthorizationCode, code) if code else None
    if auth_code is None or auth_code.client_id != client_id:
        return _oauth_error("invalid_grant", "Authorization code is invalid.")

    # Single-use + expiry enforcement.
    if auth_code.used or auth_code.expires_at < utcnow():
        db.delete(auth_code)
        db.commit()
        return _oauth_error("invalid_grant", "Authorization code expired or already used.")

    if auth_code.redirect_uri != redirect_uri:
        return _oauth_error("invalid_grant", "redirect_uri mismatch.")

    # PKCE verification when a challenge was supplied at /authorize.
    if auth_code.code_challenge:
        if not code_verifier:
            return _oauth_error("invalid_grant", "code_verifier required.")
        digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
        computed = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
        if not secrets.compare_digest(computed, auth_code.code_challenge):
            return _oauth_error("invalid_grant", "PKCE verification failed.")

    user = db.get(User, auth_code.user_id)
    if user is None:
        return _oauth_error("invalid_grant", "User no longer exists.")

    # Mark consumed before issuing tokens.
    auth_code.used = True
    db.commit()

    now = int(time.time())
    scope = auth_code.scope
    sub = str(user.id)

    access_claims = {
        "iss": settings.issuer, "sub": sub, "aud": client_id,
        "iat": now, "exp": now + settings.access_token_ttl,
        "scope": scope, "typ": "access", "jti": secrets.token_urlsafe(12),
    }
    access_token = key_manager.sign(access_claims)

    response = {
        "access_token": access_token,
        "token_type": "Bearer",
        "expires_in": settings.access_token_ttl,
        "scope": scope,
    }

    if "openid" in scope.split():
        id_claims = {
            "iss": settings.issuer, "sub": sub, "aud": client_id,
            "iat": now, "exp": now + settings.id_token_ttl, "auth_time": now,
        }
        if auth_code.nonce:
            id_claims["nonce"] = auth_code.nonce
        if "profile" in scope.split():
            id_claims["preferred_username"] = user.username
        if "email" in scope.split():
            id_claims["email"] = user.email
            id_claims["email_verified"] = False
        response["id_token"] = key_manager.sign(id_claims)

    resp = JSONResponse(response)
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["Pragma"] = "no-cache"
    return resp


# ---------------------------------------------------------------------------
# UserInfo endpoint (Bearer access token)
# ---------------------------------------------------------------------------
@router.get("/userinfo")
@router.post("/userinfo")
def userinfo(request: Request, db: Session = Depends(get_db)):
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        resp = _oauth_error("invalid_token", "Missing bearer token.", 401)
        resp.headers["WWW-Authenticate"] = "Bearer"
        return resp

    token_str = auth.split(" ", 1)[1].strip()
    try:
        claims = key_manager.verify(token_str)
    except Exception:
        resp = _oauth_error("invalid_token", "Token is invalid or expired.", 401)
        resp.headers["WWW-Authenticate"] = 'Bearer error="invalid_token"'
        return resp

    if claims.get("typ") != "access":
        return _oauth_error("invalid_token", "Not an access token.", 401)

    user = db.get(User, int(claims.get("sub", "0") or 0))
    if user is None:
        return _oauth_error("invalid_token", "Unknown subject.", 401)

    scope = (claims.get("scope") or "").split()
    info = {"sub": str(user.id)}
    if "profile" in scope:
        info["preferred_username"] = user.username
    if "email" in scope:
        info["email"] = user.email
        info["email_verified"] = False
    resp = JSONResponse(info)
    resp.headers["Cache-Control"] = "no-store"
    return resp


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _url_quote(value: str) -> str:
    from urllib.parse import quote
    return quote(value, safe="")


def _redirect_back(redirect_uri: str, params: dict) -> RedirectResponse:
    from urllib.parse import urlencode
    sep = "&" if "?" in redirect_uri else "?"
    url = f"{redirect_uri}{sep}{urlencode(params)}"
    return RedirectResponse(url, status_code=status.HTTP_303_SEE_OTHER)
