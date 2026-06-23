"""FastAPI multi-tenant SaaS skeleton.

Security controls implemented here (mapped to OWASP Top 10):
  * A01 Broken Access Control: every query is org-scoped; ownership checks on
    every project mutation prevent IDOR; admin-only routes gated by role.
  * A02 Cryptographic Failures: passwords hashed with bcrypt; signed,
    HttpOnly/Secure/SameSite session cookies.
  * A03 Injection: SQLAlchemy ORM uses bound parameters everywhere; Jinja2
    autoescaping prevents XSS.
  * A05 Security Misconfiguration: strict security headers; generic error
    pages (no stack traces); secrets read from the environment.
  * A07 Identification & Auth Failures: org-scoped login, session fixation
    protection (session reset on login), CSRF tokens on all writes.
"""
import logging
import os

from fastapi import Depends, FastAPI, Form, Request
from fastapi.responses import RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.middleware.sessions import SessionMiddleware

from .config import get_settings
from .database import Base, engine, get_db
from .deps import (
    CSRFError,
    Forbidden,
    NotAuthenticated,
    get_current_user,
    require_admin,
    require_user,
    verify_csrf,
)
from .models import ROLE_ADMIN, ROLE_MEMBER, Organisation, Project, User
from .security import (
    ValidationError,
    clean_email,
    clean_password,
    clean_role,
    clean_str,
    hash_password,
    slugify,
    verify_password,
)
from .templating import flash, render

logger = logging.getLogger("saas")
settings = get_settings()

app = FastAPI(title="Multi-Tenant SaaS Skeleton", docs_url=None, redoc_url=None)

# Signed session cookie. HttpOnly is set by Starlette; Secure via https_only;
# SameSite=Lax blocks cross-site cookie sending for top-level navigations.
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.secret_key,
    session_cookie="session",
    https_only=settings.session_cookie_secure,
    same_site="lax",
    max_age=60 * 60 * 8,  # 8 hours
)

app.mount(
    "/static",
    StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static")),
    name="static",
)


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)


# --- Security headers --------------------------------------------------------


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "style-src 'self'; "
        "script-src 'self'; "
        "img-src 'self' data:; "
        "form-action 'self'; "
        "frame-ancestors 'none'; "
        "base-uri 'self'"
    )
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    if settings.session_cookie_secure:
        response.headers["Strict-Transport-Security"] = (
            "max-age=63072000; includeSubDomains"
        )
    return response


# --- Exception handlers (no internal details leak to clients) ----------------


@app.exception_handler(NotAuthenticated)
async def handle_not_authenticated(request: Request, exc: NotAuthenticated):
    return RedirectResponse("/login", status_code=303)


@app.exception_handler(Forbidden)
async def handle_forbidden(request: Request, exc: Forbidden):
    return render(request, "error.html", status_code=403,
                  code=403, message="You do not have permission to do that.")


@app.exception_handler(CSRFError)
async def handle_csrf(request: Request, exc: CSRFError):
    return render(request, "error.html", status_code=403,
                  code=403, message="Invalid or missing CSRF token. Please retry.")


@app.exception_handler(404)
async def handle_404(request: Request, exc):
    return render(request, "error.html", status_code=404,
                  code=404, message="Page not found.")


@app.exception_handler(Exception)
async def handle_unexpected(request: Request, exc: Exception):
    # Log full detail server-side; return a generic message to the client.
    logger.exception("Unhandled error processing %s %s", request.method, request.url.path)
    return render(request, "error.html", status_code=500,
                  code=500, message="Something went wrong. Please try again later.")


# --- Public routes -----------------------------------------------------------


@app.get("/")
async def index(request: Request, user: User | None = Depends(get_current_user)):
    if user:
        return RedirectResponse("/dashboard", status_code=303)
    return RedirectResponse("/login", status_code=303)


@app.get("/signup")
async def signup_form(request: Request, user: User | None = Depends(get_current_user)):
    if user:
        return RedirectResponse("/dashboard", status_code=303)
    return render(request, "signup.html")


@app.post("/signup")
async def signup(
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(verify_csrf),
    org_name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
):
    """Create a new organisation plus its first user (an admin)."""
    try:
        org_name_clean = clean_str(org_name, field="Organisation name", min_len=2, max_len=120)
        email_clean = clean_email(email)
        password_clean = clean_password(password)
    except ValidationError as exc:
        flash(request, str(exc), "error")
        return render(request, "signup.html", org_name=org_name, email=email,
                      status_code=400)

    slug = slugify(org_name_clean)
    if not slug:
        flash(request, "Could not derive a valid slug from that name.", "error")
        return render(request, "signup.html", org_name=org_name, email=email,
                      status_code=400)

    # Ensure slug uniqueness (parameterised query via ORM).
    base_slug, n = slug, 1
    while db.query(Organisation).filter(Organisation.slug == slug).first():
        n += 1
        slug = f"{base_slug}-{n}"

    org = Organisation(name=org_name_clean, slug=slug)
    db.add(org)
    db.flush()  # assign org.id

    admin = User(
        org_id=org.id,
        email=email_clean,
        password_hash=hash_password(password_clean),
        role=ROLE_ADMIN,
    )
    db.add(admin)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        flash(request, "That account could not be created.", "error")
        return render(request, "signup.html", org_name=org_name, email=email,
                      status_code=400)

    flash(request, f"Organisation created. Your login slug is '{slug}'.", "success")
    return RedirectResponse("/login", status_code=303)


@app.get("/login")
async def login_form(request: Request, user: User | None = Depends(get_current_user)):
    if user:
        return RedirectResponse("/dashboard", status_code=303)
    return render(request, "login.html")


@app.post("/login")
async def login(
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(verify_csrf),
    org_slug: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
):
    """Org-scoped login: credentials are only valid within their organisation."""
    org_slug_clean = (org_slug or "").strip().lower()
    email_clean = (email or "").strip().lower()

    org = (
        db.query(Organisation)
        .filter(Organisation.slug == org_slug_clean)
        .first()
    )
    user = None
    if org:
        user = (
            db.query(User)
            .filter(User.org_id == org.id, User.email == email_clean)
            .first()
        )

    # Generic failure message; avoid revealing whether org/email exists.
    if not user or not verify_password(password or "", user.password_hash):
        flash(request, "Invalid organisation, email, or password.", "error")
        return render(request, "login.html", org_slug=org_slug, email=email,
                      status_code=401)

    # Session fixation protection: clear any existing session, then set identity.
    request.session.clear()
    request.session["user_id"] = user.id
    request.session["org_id"] = user.org_id
    flash(request, "Signed in successfully.", "success")
    return RedirectResponse("/dashboard", status_code=303)


@app.post("/logout")
async def logout(request: Request, _: None = Depends(verify_csrf)):
    request.session.clear()
    return RedirectResponse("/login", status_code=303)


# --- Authenticated: projects (sample resource) -------------------------------


@app.get("/dashboard")
async def dashboard(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    # Admins see all org projects; members see only their own.
    query = db.query(Project).filter(Project.org_id == user.org_id)
    if not user.is_admin:
        query = query.filter(Project.owner_id == user.id)
    projects = query.order_by(Project.created_at.desc()).all()
    return render(request, "dashboard.html", user=user, projects=projects)


@app.get("/projects/new")
async def project_new_form(request: Request, user: User = Depends(require_user)):
    return render(request, "project_form.html", user=user, project=None)


@app.post("/projects")
async def project_create(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    _: None = Depends(verify_csrf),
    name: str = Form(...),
    description: str = Form(default=""),
):
    try:
        name_clean = clean_str(name, field="Project name", min_len=1, max_len=120)
        description_clean = clean_str(
            description, field="Description", min_len=0, max_len=2000
        )
    except ValidationError as exc:
        flash(request, str(exc), "error")
        return render(request, "project_form.html", user=user, project=None,
                      status_code=400)

    project = Project(
        org_id=user.org_id,
        owner_id=user.id,
        name=name_clean,
        description=description_clean,
    )
    db.add(project)
    db.commit()
    flash(request, "Project created.", "success")
    return RedirectResponse(f"/projects/{project.id}", status_code=303)


def _load_owned_project(db: Session, user: User, project_id: int) -> Project | None:
    """Fetch a project enforcing tenant scope and (for members) ownership.

    This single chokepoint prevents IDOR: even with a guessed id, a user can
    only ever load projects in their own org, and members only their own.
    """
    query = db.query(Project).filter(
        Project.id == project_id, Project.org_id == user.org_id
    )
    if not user.is_admin:
        query = query.filter(Project.owner_id == user.id)
    return query.first()


@app.get("/projects/{project_id}")
async def project_detail(
    project_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    project = _load_owned_project(db, user, project_id)
    if project is None:
        return render(request, "error.html", status_code=404,
                      code=404, message="Project not found.")
    return render(request, "project_detail.html", user=user, project=project)


@app.get("/projects/{project_id}/edit")
async def project_edit_form(
    project_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    project = _load_owned_project(db, user, project_id)
    if project is None:
        return render(request, "error.html", status_code=404,
                      code=404, message="Project not found.")
    return render(request, "project_form.html", user=user, project=project)


@app.post("/projects/{project_id}/edit")
async def project_update(
    project_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    _: None = Depends(verify_csrf),
    name: str = Form(...),
    description: str = Form(default=""),
):
    project = _load_owned_project(db, user, project_id)
    if project is None:
        return render(request, "error.html", status_code=404,
                      code=404, message="Project not found.")
    try:
        project.name = clean_str(name, field="Project name", min_len=1, max_len=120)
        project.description = clean_str(
            description, field="Description", min_len=0, max_len=2000
        )
    except ValidationError as exc:
        flash(request, str(exc), "error")
        return render(request, "project_form.html", user=user, project=project,
                      status_code=400)
    db.commit()
    flash(request, "Project updated.", "success")
    return RedirectResponse(f"/projects/{project.id}", status_code=303)


@app.post("/projects/{project_id}/delete")
async def project_delete(
    project_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    _: None = Depends(verify_csrf),
):
    project = _load_owned_project(db, user, project_id)
    if project is None:
        return render(request, "error.html", status_code=404,
                      code=404, message="Project not found.")
    db.delete(project)
    db.commit()
    flash(request, "Project deleted.", "success")
    return RedirectResponse("/dashboard", status_code=303)


# --- Admin: user management (org-scoped) -------------------------------------


@app.get("/admin/users")
async def admin_users(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    users = (
        db.query(User)
        .filter(User.org_id == user.org_id)
        .order_by(User.created_at.asc())
        .all()
    )
    return render(request, "admin_users.html", user=user, users=users)


@app.post("/admin/users")
async def admin_create_user(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
    _: None = Depends(verify_csrf),
    email: str = Form(...),
    password: str = Form(...),
    role: str = Form(default=ROLE_MEMBER),
):
    try:
        email_clean = clean_email(email)
        password_clean = clean_password(password)
        role_clean = clean_role(role)
    except ValidationError as exc:
        flash(request, str(exc), "error")
        return RedirectResponse("/admin/users", status_code=303)

    existing = (
        db.query(User)
        .filter(User.org_id == user.org_id, User.email == email_clean)
        .first()
    )
    if existing:
        flash(request, "A user with that email already exists in your organisation.",
              "error")
        return RedirectResponse("/admin/users", status_code=303)

    new_user = User(
        org_id=user.org_id,  # always the admin's own org — no cross-tenant creation
        email=email_clean,
        password_hash=hash_password(password_clean),
        role=role_clean,
    )
    db.add(new_user)
    db.commit()
    flash(request, f"User {email_clean} created.", "success")
    return RedirectResponse("/admin/users", status_code=303)


@app.post("/admin/users/{user_id}/delete")
async def admin_delete_user(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
    _: None = Depends(verify_csrf),
):
    if user_id == user.id:
        flash(request, "You cannot delete your own account.", "error")
        return RedirectResponse("/admin/users", status_code=303)

    # Scope by org_id so an admin can never delete users in another tenant.
    target = (
        db.query(User)
        .filter(User.id == user_id, User.org_id == user.org_id)
        .first()
    )
    if target is None:
        flash(request, "User not found.", "error")
        return RedirectResponse("/admin/users", status_code=303)

    db.delete(target)
    db.commit()
    flash(request, "User deleted.", "success")
    return RedirectResponse("/admin/users", status_code=303)


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}
