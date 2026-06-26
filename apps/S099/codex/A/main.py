import hashlib
import hmac
import html
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urlencode

from fastapi import Depends, FastAPI, Form, Header, HTTPException, Query, status
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, HttpUrl
from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker


APP_NAME = "FastAPI Identity Provider"
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./identity_provider.db")
ISSUER = os.getenv("ISSUER", "http://127.0.0.1:5099")
JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", "60"))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(255))
    hashed_password: Mapped[str] = mapped_column(String(255))
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    client_name: Mapped[str] = mapped_column(String(255))
    client_secret_hash: Mapped[str] = mapped_column(String(255))
    redirect_uri: Mapped[str] = mapped_column(Text)
    allowed_scopes: Mapped[str] = mapped_column(String(255), default="openid profile email")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    codes: Mapped[list["AuthorizationCode"]] = relationship(back_populates="client")


class AuthorizationCode(Base):
    __tablename__ = "authorization_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    redirect_uri: Mapped[str] = mapped_column(Text)
    scope: Mapped[str] = mapped_column(String(255))
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used: Mapped[bool] = mapped_column(Boolean, default=False)

    client: Mapped[Client] = relationship(back_populates="codes")
    user: Mapped[User] = relationship()


class ClientRegistration(BaseModel):
    client_name: str
    redirect_uri: HttpUrl
    allowed_scopes: str = "openid profile email"


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "Bearer"
    expires_in: int
    scope: str


app = FastAPI(title=APP_NAME)
security = HTTPBasic()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def verify_secret(secret: str, secret_hash: str) -> bool:
    return hmac.compare_digest(hash_secret(secret), secret_hash)


def create_access_token(user: User, client: Client, scope: str) -> str:
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=ACCESS_TOKEN_MINUTES)
    payload = {
        "iss": ISSUER,
        "sub": str(user.id),
        "aud": client.client_id,
        "client_id": client.client_id,
        "email": user.email,
        "name": user.display_name,
        "scope": scope,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_client_by_client_id(db: Session, client_id: str) -> Optional[Client]:
    return db.scalar(select(Client).where(Client.client_id == client_id))


def authenticate_user(db: Session, email: str, password: str) -> Optional[User]:
    user = db.scalar(select(User).where(User.email == email))
    if not user or not user.is_active or not verify_password(password, user.hashed_password):
        return None
    return user


def authenticate_client(db: Session, client_id: str, client_secret: str) -> Client:
    client = get_client_by_client_id(db, client_id)
    if not client or not client.is_active or not verify_secret(client_secret, client.client_secret_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid client credentials")
    return client


def require_admin(
    credentials: HTTPBasicCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    user = authenticate_user(db, credentials.username, credentials.password)
    if not user or not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Admin credentials required",
            headers={"WWW-Authenticate": "Basic"},
        )
    return user


def bearer_payload(authorization: Optional[str]) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1]
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM], options={"verify_aud": False})
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid bearer token")


def html_page(title: str, body: str) -> HTMLResponse:
    return HTMLResponse(
        f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <style>
    :root {{ color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
    body {{ margin: 0; background: #f5f7fb; color: #172033; }}
    header {{ background: #ffffff; border-bottom: 1px solid #dfe5ef; padding: 18px 28px; }}
    main {{ max-width: 1040px; margin: 0 auto; padding: 28px; }}
    h1 {{ margin: 0; font-size: 24px; }}
    h2 {{ margin-top: 0; font-size: 18px; }}
    section, form {{ background: #ffffff; border: 1px solid #dfe5ef; border-radius: 8px; padding: 20px; margin-bottom: 20px; }}
    label {{ display: block; margin: 12px 0 6px; font-weight: 650; }}
    input, textarea {{ box-sizing: border-box; width: 100%; border: 1px solid #b8c2d4; border-radius: 6px; padding: 10px 12px; font: inherit; }}
    button {{ border: 0; border-radius: 6px; background: #1267d8; color: #fff; cursor: pointer; font-weight: 700; padding: 10px 14px; }}
    table {{ width: 100%; border-collapse: collapse; background: #fff; }}
    th, td {{ border-bottom: 1px solid #e5eaf2; padding: 10px; text-align: left; vertical-align: top; }}
    th {{ color: #516071; font-size: 13px; }}
    code {{ background: #edf2f7; border-radius: 4px; padding: 2px 5px; }}
    .error {{ color: #a32626; font-weight: 700; }}
    .secret {{ background: #e9f7ef; border: 1px solid #b5dfc5; border-radius: 6px; padding: 12px; }}
  </style>
</head>
<body>
  <header><h1>{APP_NAME}</h1></header>
  <main>{body}</main>
</body>
</html>"""
    )


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        admin = db.scalar(select(User).where(User.email == "admin@example.com"))
        if not admin:
            db.add(
                User(
                    email="admin@example.com",
                    display_name="Admin",
                    hashed_password=hash_password("admin123"),
                    is_admin=True,
                )
            )
        sample_user = db.scalar(select(User).where(User.email == "user@example.com"))
        if not sample_user:
            db.add(
                User(
                    email="user@example.com",
                    display_name="Demo User",
                    hashed_password=hash_password("user123"),
                    is_admin=False,
                )
            )
        demo_client = db.scalar(select(Client).where(Client.client_id == "demo-client"))
        if not demo_client:
            db.add(
                Client(
                    client_id="demo-client",
                    client_name="Demo Client",
                    client_secret_hash=hash_secret("demo-secret"),
                    redirect_uri="http://127.0.0.1:5099/callback",
                )
            )
        db.commit()


@app.get("/")
def root():
    return {"name": APP_NAME, "issuer": ISSUER, "admin": f"{ISSUER}/admin"}


@app.get("/.well-known/openid-configuration")
def discovery():
    return {
        "issuer": ISSUER,
        "authorization_endpoint": f"{ISSUER}/authorize",
        "token_endpoint": f"{ISSUER}/token",
        "userinfo_endpoint": f"{ISSUER}/userinfo",
        "registration_endpoint": f"{ISSUER}/clients/register",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "password"],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": [JWT_ALGORITHM],
        "scopes_supported": ["openid", "profile", "email"],
    }


@app.post("/clients/register")
def register_client(payload: ClientRegistration, db: Session = Depends(get_db)):
    client_id = "client_" + secrets.token_urlsafe(18)
    client_secret = secrets.token_urlsafe(32)
    client = Client(
        client_id=client_id,
        client_name=payload.client_name,
        client_secret_hash=hash_secret(client_secret),
        redirect_uri=str(payload.redirect_uri),
        allowed_scopes=payload.allowed_scopes,
    )
    db.add(client)
    db.commit()
    return {
        "client_id": client_id,
        "client_secret": client_secret,
        "client_name": payload.client_name,
        "redirect_uri": str(payload.redirect_uri),
        "allowed_scopes": payload.allowed_scopes,
    }


@app.get("/authorize", response_class=HTMLResponse)
def authorize_form(
    client_id: str = Query(...),
    redirect_uri: str = Query(...),
    response_type: str = Query("code"),
    scope: str = Query("openid profile email"),
    state: str = Query(""),
    error: str = Query(""),
    db: Session = Depends(get_db),
):
    if response_type != "code":
        raise HTTPException(status_code=400, detail="Only response_type=code is supported")
    client = get_client_by_client_id(db, client_id)
    if not client or not client.is_active or client.redirect_uri != redirect_uri:
        raise HTTPException(status_code=400, detail="Invalid client or redirect URI")
    error_html = f'<p class="error">{html.escape(error)}</p>' if error else ""
    return html_page(
        "Login",
        f"""
<form method="post" action="/login">
  <h2>Sign in to continue to {html.escape(client.client_name)}</h2>
  {error_html}
  <input type="hidden" name="client_id" value="{html.escape(client_id)}">
  <input type="hidden" name="redirect_uri" value="{html.escape(redirect_uri)}">
  <input type="hidden" name="scope" value="{html.escape(scope)}">
  <input type="hidden" name="state" value="{html.escape(state)}">
  <label>Email</label>
  <input name="email" type="email" autocomplete="username" required>
  <label>Password</label>
  <input name="password" type="password" autocomplete="current-password" required>
  <p><button type="submit">Sign in</button></p>
</form>""",
    )


@app.post("/login")
def login(
    email: str = Form(...),
    password: str = Form(...),
    client_id: str = Form(...),
    redirect_uri: str = Form(...),
    scope: str = Form("openid profile email"),
    state: str = Form(""),
    db: Session = Depends(get_db),
):
    client = get_client_by_client_id(db, client_id)
    if not client or not client.is_active or client.redirect_uri != redirect_uri:
        raise HTTPException(status_code=400, detail="Invalid client or redirect URI")
    user = authenticate_user(db, email, password)
    if not user:
        query = urlencode(
            {
                "client_id": client_id,
                "redirect_uri": redirect_uri,
                "scope": scope,
                "state": state,
                "error": "Invalid email or password",
            }
        )
        return RedirectResponse(f"/authorize?{query}", status_code=303)
    code = secrets.token_urlsafe(36)
    db.add(
        AuthorizationCode(
            code=code,
            client_id=client.id,
            user_id=user.id,
            redirect_uri=redirect_uri,
            scope=scope,
            expires_at=datetime.utcnow() + timedelta(minutes=5),
        )
    )
    db.commit()
    params = {"code": code}
    if state:
        params["state"] = state
    return RedirectResponse(f"{redirect_uri}?{urlencode(params)}", status_code=303)


@app.post("/token", response_model=TokenResponse)
def token(
    grant_type: str = Form(...),
    client_id: str = Form(...),
    client_secret: str = Form(...),
    code: str = Form(""),
    redirect_uri: str = Form(""),
    username: str = Form(""),
    password: str = Form(""),
    scope: str = Form("openid profile email"),
    db: Session = Depends(get_db),
):
    client = authenticate_client(db, client_id, client_secret)
    if grant_type == "authorization_code":
        auth_code = db.scalar(select(AuthorizationCode).where(AuthorizationCode.code == code))
        if (
            not auth_code
            or auth_code.used
            or auth_code.client_id != client.id
            or auth_code.redirect_uri != redirect_uri
            or auth_code.expires_at < datetime.utcnow()
        ):
            raise HTTPException(status_code=400, detail="Invalid authorization code")
        auth_code.used = True
        access_token = create_access_token(auth_code.user, client, auth_code.scope)
        db.commit()
        return TokenResponse(access_token=access_token, expires_in=ACCESS_TOKEN_MINUTES * 60, scope=auth_code.scope)
    if grant_type == "password":
        user = authenticate_user(db, username, password)
        if not user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user credentials")
        access_token = create_access_token(user, client, scope)
        return TokenResponse(access_token=access_token, expires_in=ACCESS_TOKEN_MINUTES * 60, scope=scope)
    raise HTTPException(status_code=400, detail="Unsupported grant type")


@app.get("/userinfo")
def userinfo(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)):
    payload = bearer_payload(authorization)
    user = db.get(User, int(payload["sub"]))
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User is inactive")
    return {
        "sub": str(user.id),
        "email": user.email,
        "email_verified": True,
        "name": user.display_name,
        "client_id": payload.get("client_id"),
        "scope": payload.get("scope", ""),
    }


@app.get("/callback", response_class=HTMLResponse)
def callback(code: str = "", state: str = ""):
    return html_page(
        "Callback",
        f"""
<section>
  <h2>Demo callback</h2>
  <p>Authorization code:</p>
  <p><code>{html.escape(code)}</code></p>
  <p>State: <code>{html.escape(state)}</code></p>
</section>""",
    )


@app.get("/admin", response_class=HTMLResponse)
def admin_page(
    created_client_id: str = "",
    created_secret: str = "",
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    clients = db.scalars(select(Client).order_by(Client.created_at.desc())).all()
    rows = "".join(
        f"""
<tr>
  <td><code>{html.escape(client.client_id)}</code></td>
  <td>{html.escape(client.client_name)}</td>
  <td>{html.escape(client.redirect_uri)}</td>
  <td>{html.escape(client.allowed_scopes)}</td>
  <td>{"active" if client.is_active else "disabled"}</td>
  <td>
    <form method="post" action="/admin/clients/{client.id}/toggle" style="padding:0;margin:0;border:0;background:transparent">
      <button type="submit">{"Disable" if client.is_active else "Enable"}</button>
    </form>
  </td>
</tr>"""
        for client in clients
    )
    secret_html = (
        f"""
<section class="secret">
  <h2>Client secret created</h2>
  <p>Client ID: <code>{html.escape(created_client_id)}</code></p>
  <p>Client secret: <code>{html.escape(created_secret)}</code></p>
  <p>This secret is shown once.</p>
</section>"""
        if created_client_id and created_secret
        else ""
    )
    return html_page(
        "Admin",
        f"""
{secret_html}
<form method="post" action="/admin/clients">
  <h2>Register client</h2>
  <label>Client name</label>
  <input name="client_name" required>
  <label>Redirect URI</label>
  <input name="redirect_uri" type="url" placeholder="http://127.0.0.1:5099/callback" required>
  <label>Allowed scopes</label>
  <input name="allowed_scopes" value="openid profile email" required>
  <p><button type="submit">Create client</button></p>
</form>
<section>
  <h2>Clients</h2>
  <table>
    <thead><tr><th>Client ID</th><th>Name</th><th>Redirect URI</th><th>Scopes</th><th>Status</th><th></th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
</section>""",
    )


@app.post("/admin/clients")
def admin_create_client(
    client_name: str = Form(...),
    redirect_uri: str = Form(...),
    allowed_scopes: str = Form("openid profile email"),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    client_id = "client_" + secrets.token_urlsafe(18)
    client_secret = secrets.token_urlsafe(32)
    db.add(
        Client(
            client_id=client_id,
            client_name=client_name,
            client_secret_hash=hash_secret(client_secret),
            redirect_uri=redirect_uri,
            allowed_scopes=allowed_scopes,
        )
    )
    db.commit()
    return RedirectResponse(
        f"/admin?{urlencode({'created_client_id': client_id, 'created_secret': client_secret})}",
        status_code=303,
    )


@app.post("/admin/clients/{client_pk}/toggle")
def admin_toggle_client(client_pk: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    client = db.get(Client, client_pk)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    client.is_active = not client.is_active
    db.commit()
    return RedirectResponse("/admin", status_code=303)
