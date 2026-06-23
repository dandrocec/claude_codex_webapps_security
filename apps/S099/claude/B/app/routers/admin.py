"""Admin page to manage OAuth client applications.

Access control: a user may only view and modify clients they own. Users with
is_admin may manage all clients. Ownership is checked on every mutation to
prevent IDOR.
"""
import secrets

from fastapi import APIRouter, Request, Depends, Form, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, Client
from ..deps import get_current_user, render
from ..security import hash_secret
from ..csrf import validate_csrf
from ..validators import validate_client_name, validate_redirect_uris

router = APIRouter()


def _require_login(request: Request, user: User | None):
    if user is None:
        return RedirectResponse("/login?next=/clients", status_code=status.HTTP_303_SEE_OTHER)
    return None


def _visible_clients(db: Session, user: User) -> list[Client]:
    stmt = select(Client).order_by(Client.created_at.desc())
    if not user.is_admin:
        stmt = stmt.where(Client.owner_id == user.id)
    return list(db.execute(stmt).scalars().all())


@router.get("/clients")
def list_clients(request: Request, db: Session = Depends(get_db),
                 user: User | None = Depends(get_current_user)):
    redirect = _require_login(request, user)
    if redirect:
        return redirect

    # A freshly created secret is shown exactly once, via the session.
    new_secret = request.session.pop("new_client_secret", None)
    new_secret_id = request.session.pop("new_client_id", None)
    return render(request, "clients.html", {
        "current_user": user,
        "clients": _visible_clients(db, user),
        "errors": [],
        "values": {},
        "new_secret": new_secret,
        "new_secret_id": new_secret_id,
    })


@router.post("/clients")
def create_client(
    request: Request,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user),
    csrf_token: str = Form(""),
    name: str = Form(""),
    redirect_uris: str = Form(""),
):
    redirect = _require_login(request, user)
    if redirect:
        return redirect

    if not validate_csrf(request, csrf_token):
        return render(request, "clients.html", {
            "current_user": user, "clients": _visible_clients(db, user),
            "errors": ["Invalid or expired form token. Please try again."],
            "values": {"name": name, "redirect_uris": redirect_uris},
        }, status_code=400)

    errors = []
    name_clean, e = validate_client_name(name)
    if e:
        errors.append(e)
    uris, e = validate_redirect_uris(redirect_uris)
    if e:
        errors.append(e)

    if errors:
        return render(request, "clients.html", {
            "current_user": user, "clients": _visible_clients(db, user),
            "errors": errors, "values": {"name": name, "redirect_uris": redirect_uris},
        }, status_code=400)

    client_id = "cl_" + secrets.token_urlsafe(16)
    client_secret = secrets.token_urlsafe(32)
    client = Client(
        client_id=client_id,
        client_secret_hash=hash_secret(client_secret),
        name=name_clean,
        redirect_uris="\n".join(uris),
        owner_id=user.id,
    )
    db.add(client)
    db.commit()

    # Surface the plaintext secret once on the next page load.
    request.session["new_client_secret"] = client_secret
    request.session["new_client_id"] = client_id
    return RedirectResponse("/clients", status_code=status.HTTP_303_SEE_OTHER)


@router.post("/clients/{client_pk}/delete")
def delete_client(
    client_pk: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user),
    csrf_token: str = Form(""),
):
    redirect = _require_login(request, user)
    if redirect:
        return redirect

    if not validate_csrf(request, csrf_token):
        return render(request, "clients.html", {
            "current_user": user, "clients": _visible_clients(db, user),
            "errors": ["Invalid or expired form token. Please try again."], "values": {},
        }, status_code=400)

    client = db.get(Client, client_pk)
    # IDOR guard: must exist and be owned by the caller (unless admin).
    if client is None or (client.owner_id != user.id and not user.is_admin):
        return render(request, "clients.html", {
            "current_user": user, "clients": _visible_clients(db, user),
            "errors": ["Client not found."], "values": {},
        }, status_code=404)

    db.delete(client)
    db.commit()
    return RedirectResponse("/clients", status_code=status.HTTP_303_SEE_OTHER)
