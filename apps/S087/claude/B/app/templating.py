"""Jinja2 template configuration and a render helper.

Autoescaping is enabled for all HTML templates, providing context-aware output
encoding that mitigates XSS for any user-supplied value rendered with `{{ }}`.
"""
import os

from fastapi import Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from .models import User
from .security import get_or_create_csrf_token

_TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), "templates")

templates = Jinja2Templates(directory=_TEMPLATE_DIR)
# Jinja2Templates enables autoescape for .html by default; make it explicit.
templates.env.autoescape = True


def pop_flashes(request: Request) -> list[dict]:
    flashes = request.session.pop("_flashes", [])
    return flashes


def flash(request: Request, message: str, category: str = "info") -> None:
    request.session.setdefault("_flashes", []).append(
        {"message": message, "category": category}
    )


def render(
    request: Request,
    template_name: str,
    *,
    user: User | None = None,
    status_code: int = 200,
    **context,
) -> HTMLResponse:
    base_context = {
        "current_user": user,
        "csrf_token": get_or_create_csrf_token(request.session),
        "flashes": pop_flashes(request),
    }
    base_context.update(context)
    # New-style Starlette signature: request is the first positional argument.
    return templates.TemplateResponse(
        request, template_name, base_context, status_code=status_code
    )
