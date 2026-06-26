import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated

import jwt
from fastapi import Depends, FastAPI, Form, Header, HTTPException, Request, Response, status
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from itsdangerous import BadSignature, URLSafeSerializer
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field, ValidationError, constr
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker
from starlette.middleware.sessions import SessionMiddleware


DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./idp.sqlite3")
SESSION_SECRET = os.getenv("IDP_SESSION_SECRET")
JWT_SECRET = os.getenv("IDP_JWT_SECRET")
ISSUER = os.getenv("IDP_ISSUER", "http://127.0.0.1:5099")
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "true").lower() != "false"
ACCESS_TOKEN_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", "30"))

if not SESSION_SECRET or not JWT_SECRET:
    raise RuntimeError("IDP_SESSION_SECRET and IDP_JWT_SECRET must be set")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
templates = Jinja2Templates(directory="app/templates")
passwords = CryptContext(schemes=["argon2"], deprecated="auto")
csrf_signer = URLSafeSerializer(SESSION_SECRET, salt="csrf")


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Client(Base):
    __tablename__ = "clients"
    __table_args__ = (UniqueConstraint("client_id", name="uq_clients_client_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    client_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    client_secret_hash: Mapped[str] = mapped_column(Text, nullable=False)
    redirect_uri: Mapped[str] = mapped_column(String(500), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    owner: Mapped[User] = relationship()


class TokenRecord(Base):
    __tablename__ = "token_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), nullable=False, index=True)
    jti_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class RegisterInput(BaseModel):
    email: EmailStr
    password: constr(min_length=12, max_length=128)
    full_name: constr(min_length=1, max_length=120, pattern=r"^[\w .,'-]+$")


class LoginInput(BaseModel):
    email: EmailStr
    password: constr(min_length=1, max_length=128)


class ClientInput(BaseModel):
    name: constr(min_length=1, max_length=80, pattern=r"^[\w .,'()-]+$")
    redirect_uri: constr(min_length=8, max_length=500, pattern=r"^https?://[^\s]+$")


class TokenInput(BaseModel):
    grant_type: constr(pattern=r"^password$")
    client_id: constr(min_length=20, max_length=64)
    client_secret: constr(min_length=32, max_length=256)
    username: EmailStr
    password: constr(min_length=1, max_length=128)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    Base.metadata.create_all(engine)
    admin_email = os.getenv("IDP_ADMIN_EMAIL")
    admin_password = os.getenv("IDP_ADMIN_PASSWORD")
    if admin_email and admin_password:
        with SessionLocal() as db:
            existing = db.scalar(select(User).where(User.email == admin_email.lower()))
            if not existing:
                db.add(User(
                    email=admin_email.lower(),
                    password_hash=passwords.hash(admin_password),
                    full_name="Administrator",
                    is_admin=True,
                ))
                db.commit()


app = FastAPI(title="FastAPI Identity Provider", docs_url=None, redoc_url=None)
app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET,
    https_only=COOKIE_SECURE,
    same_site="strict",
    session_cookie="idp_session",
    max_age=60 * 60,
)


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.middleware("http")
async def security_headers(request: Request, call_next):
    try:
        response = await call_next(request)
    except Exception:
        return JSONResponse({"detail": "Internal server error"}, status_code=500)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = "default-src 'self'; style-src 'self' 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'"
    return response


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)


@app.exception_handler(ValidationError)
async def validation_exception_handler(request: Request, exc: ValidationError):
    return JSONResponse({"detail": "Invalid input"}, status_code=400)


def current_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    user_id = request.session.get("user_id")
    if not user_id:
        return None
    return db.get(User, int(user_id))


def require_user(user: User | None = Depends(current_user)) -> User:
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    return user


def require_admin(user: User = Depends(require_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


def csrf_token(request: Request) -> str:
    raw = request.session.get("csrf")
    if not raw:
        raw = secrets.token_urlsafe(32)
        request.session["csrf"] = raw
    return csrf_signer.dumps(raw)


def verify_csrf(request: Request, token: str) -> None:
    try:
        raw = csrf_signer.loads(token)
    except BadSignature:
        raise HTTPException(status_code=403, detail="Invalid CSRF token")
    if not hmac.compare_digest(str(raw), str(request.session.get("csrf", ""))):
        raise HTTPException(status_code=403, detail="Invalid CSRF token")


def render(request: Request, name: str, context: dict | None = None, status_code: int = 200):
    data = {"request": request, "csrf_token": csrf_token(request), "user": request.state.user}
    if context:
        data.update(context)
    return templates.TemplateResponse(name, data, status_code=status_code)


@app.middleware("http")
async def attach_user(request: Request, call_next):
    request.state.user = None
    user_id = request.session.get("user_id")
    if user_id:
        with SessionLocal() as db:
            request.state.user = db.get(User, int(user_id))
    return await call_next(request)


@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    if request.state.user:
        return RedirectResponse("/admin/clients" if request.state.user.is_admin else "/profile", status_code=303)
    return RedirectResponse("/login", status_code=303)


@app.get("/register", response_class=HTMLResponse)
def register_page(request: Request):
    return render(request, "register.html")


@app.post("/register", response_class=HTMLResponse)
def register(
    request: Request,
    csrf: Annotated[str, Form()],
    email: Annotated[str, Form()],
    password: Annotated[str, Form()],
    full_name: Annotated[str, Form()],
    db: Session = Depends(get_db),
):
    verify_csrf(request, csrf)
    try:
        data = RegisterInput(email=email, password=password, full_name=full_name.strip())
    except ValidationError:
        return render(request, "register.html", {"error": "Use a valid email, 12+ character password, and name."}, 400)
    existing = db.scalar(select(User).where(User.email == data.email.lower()))
    if existing:
        return render(request, "register.html", {"error": "Account already exists."}, 409)
    user = User(email=data.email.lower(), password_hash=passwords.hash(data.password), full_name=data.full_name)
    db.add(user)
    db.commit()
    request.session["user_id"] = user.id
    return RedirectResponse("/profile", status_code=303)


@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    return render(request, "login.html")


@app.post("/login", response_class=HTMLResponse)
def login(
    request: Request,
    csrf: Annotated[str, Form()],
    email: Annotated[str, Form()],
    password: Annotated[str, Form()],
    db: Session = Depends(get_db),
):
    verify_csrf(request, csrf)
    try:
        data = LoginInput(email=email, password=password)
    except ValidationError:
        return render(request, "login.html", {"error": "Invalid email or password."}, 400)
    user = db.scalar(select(User).where(User.email == data.email.lower()))
    if not user or not passwords.verify(data.password, user.password_hash):
        return render(request, "login.html", {"error": "Invalid email or password."}, 401)
    request.session.clear()
    request.session["user_id"] = user.id
    request.session["csrf"] = secrets.token_urlsafe(32)
    return RedirectResponse("/admin/clients" if user.is_admin else "/profile", status_code=303)


@app.post("/logout")
def logout(request: Request, csrf: Annotated[str, Form()]):
    verify_csrf(request, csrf)
    request.session.clear()
    return RedirectResponse("/login", status_code=303)


@app.get("/profile", response_class=HTMLResponse)
def profile(request: Request, user: User = Depends(require_user), db: Session = Depends(get_db)):
    clients = db.scalars(select(Client).where(Client.owner_id == user.id).order_by(Client.created_at.desc())).all()
    return render(request, "profile.html", {"clients": clients})


@app.post("/clients", response_class=HTMLResponse)
def create_own_client(
    request: Request,
    csrf: Annotated[str, Form()],
    name: Annotated[str, Form()],
    redirect_uri: Annotated[str, Form()],
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    verify_csrf(request, csrf)
    return create_client_for_user(request, db, user, name, redirect_uri, "/profile")


@app.get("/admin/clients", response_class=HTMLResponse)
def admin_clients(request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    clients = db.scalars(select(Client).order_by(Client.created_at.desc())).all()
    users = db.scalars(select(User).order_by(User.email.asc())).all()
    return render(request, "admin_clients.html", {"clients": clients, "users": users})


@app.post("/admin/clients", response_class=HTMLResponse)
def admin_create_client(
    request: Request,
    csrf: Annotated[str, Form()],
    owner_id: Annotated[int, Form()],
    name: Annotated[str, Form()],
    redirect_uri: Annotated[str, Form()],
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    verify_csrf(request, csrf)
    owner = db.get(User, owner_id)
    if not owner:
        raise HTTPException(status_code=404, detail="User not found")
    return create_client_for_user(request, db, owner, name, redirect_uri, "/admin/clients")


@app.post("/admin/clients/{client_pk}/toggle")
def admin_toggle_client(
    request: Request,
    client_pk: int,
    csrf: Annotated[str, Form()],
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    verify_csrf(request, csrf)
    client = db.get(Client, client_pk)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    client.is_active = not client.is_active
    db.commit()
    return RedirectResponse("/admin/clients", status_code=303)


def create_client_for_user(request: Request, db: Session, owner: User, name: str, redirect_uri: str, destination: str):
    try:
        data = ClientInput(name=name.strip(), redirect_uri=redirect_uri.strip())
    except ValidationError:
        raise HTTPException(status_code=400, detail="Invalid client data")
    client_id = secrets.token_urlsafe(24)
    client_secret = secrets.token_urlsafe(48)
    client = Client(
        owner_id=owner.id,
        name=data.name,
        redirect_uri=data.redirect_uri,
        client_id=client_id,
        client_secret_hash=passwords.hash(client_secret),
    )
    db.add(client)
    db.commit()
    request.session["new_client_secret"] = client_secret
    request.session["new_client_id"] = client_id
    return RedirectResponse(destination, status_code=303)


@app.post("/token")
def token(
    grant_type: Annotated[str, Form()],
    client_id: Annotated[str, Form()],
    client_secret: Annotated[str, Form()],
    username: Annotated[str, Form()],
    password: Annotated[str, Form()],
    db: Session = Depends(get_db),
):
    try:
        data = TokenInput(
            grant_type=grant_type,
            client_id=client_id,
            client_secret=client_secret,
            username=username,
            password=password,
        )
    except ValidationError:
        raise HTTPException(status_code=400, detail="Invalid token request")
    client = db.scalar(select(Client).where(Client.client_id == data.client_id, Client.is_active.is_(True)))
    if not client or not passwords.verify(data.client_secret, client.client_secret_hash):
        raise HTTPException(status_code=401, detail="Invalid client credentials")
    user = db.scalar(select(User).where(User.email == data.username.lower()))
    if not user or not passwords.verify(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid user credentials")
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=ACCESS_TOKEN_MINUTES)
    jti = secrets.token_urlsafe(24)
    claims = {
        "iss": ISSUER,
        "sub": str(user.id),
        "aud": client.client_id,
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
        "jti": jti,
        "email": user.email,
        "name": user.full_name,
    }
    access_token = jwt.encode(claims, JWT_SECRET, algorithm="HS256")
    db.add(TokenRecord(
        user_id=user.id,
        client_id=client.id,
        jti_hash=hashlib.sha256(jti.encode()).hexdigest(),
        issued_at=now,
        expires_at=expires,
    ))
    db.commit()
    return {"access_token": access_token, "token_type": "Bearer", "expires_in": ACCESS_TOKEN_MINUTES * 60}


@app.get("/userinfo")
def userinfo(authorization: Annotated[str | None, Header()] = None, db: Session = Depends(get_db)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Bearer token required")
    token_value = authorization.removeprefix("Bearer ").strip()
    try:
        unverified = jwt.decode(token_value, options={"verify_signature": False})
        client_id = unverified.get("aud")
        client = db.scalar(select(Client).where(Client.client_id == client_id, Client.is_active.is_(True)))
        if not client:
            raise HTTPException(status_code=401, detail="Invalid token")
        claims = jwt.decode(token_value, JWT_SECRET, algorithms=["HS256"], audience=client.client_id, issuer=ISSUER)
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = db.get(User, int(claims["sub"]))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"sub": str(user.id), "email": user.email, "name": user.full_name}


@app.get("/.well-known/jwks.json")
def jwks_hint():
    return {"keys": [], "note": "Tokens use HS256. Client applications verify them with IDP_JWT_SECRET."}
