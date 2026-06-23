# Project Board

A small Flask project-management app. Users register, create projects, invite
existing members, and manage tasks on a Kanban board (**todo / doing / done**)
with assignees. Only members of a project can view or change it.

## Features

- Email/password accounts with hashed passwords (bcrypt).
- Projects with an owner and invited members.
- Tasks with title, description, status and an assignee (limited to members).
- Kanban board with one-click status moves.
- Strict per-project access control.

## Requirements

- Python 3.10+

## Run locally on port 5064

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure secrets
cp .env.example .env          # Windows: copy .env.example .env
#   then edit .env and set a strong SECRET_KEY, e.g.:
python -c "import secrets; print(secrets.token_hex(32))"

# 4. Start the app
python run.py
```

Open <http://127.0.0.1:5064>. The SQLite database is created automatically at
`instance/app.db` on first run.

### Quick start in the UI

1. Register two accounts (e.g. an owner and a teammate).
2. Log in as the owner and create a project.
3. Open the project → **Members** → invite the teammate by their email.
4. Add tasks, assign them to members, and move them across the board.

## Configuration

All configuration is read from environment variables (see `.env.example`):

| Variable | Purpose | Default |
| --- | --- | --- |
| `SECRET_KEY` | Signs session cookies and CSRF tokens. **Set this.** | random (per-restart) |
| `DATABASE_URL` | SQLAlchemy database URL | `sqlite:///instance/app.db` |
| `SESSION_COOKIE_SECURE` | Send cookies only over HTTPS; also enables HSTS | `false` |
| `FLASK_DEBUG` | Enable Flask debug mode (dev only) | `0` |

When deploying behind HTTPS, set `SESSION_COOKIE_SECURE=true`.

## Security

This app applies OWASP Top 10 best practices:

- **SQL injection** — all data access goes through SQLAlchemy, which uses
  parameterised queries; no user input is concatenated into SQL.
- **Password storage** — bcrypt hashing with a per-password random salt
  (`Flask-Bcrypt`).
- **Input validation** — every form is validated and length-bounded server-side
  with WTForms; statuses and assignees are checked against allow-lists.
- **XSS** — Jinja2 auto-escaping provides context-aware output encoding; a
  strict Content-Security-Policy disallows inline/3rd-party scripts.
- **CSRF** — `Flask-WTF` `CSRFProtect` is enabled globally; every
  state-changing POST carries and verifies a CSRF token.
- **Access control / IDOR** — every project/task route verifies membership (and
  ownership where required) before reading or mutating data; unauthorised
  access returns 404/403.
- **Session cookies** — `HttpOnly`, `SameSite=Lax`, and `Secure` (configurable).
- **Security headers** — CSP, `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, and HSTS over HTTPS.
- **Error handling** — custom 400/403/404/413/500 pages; stack traces and
  internal details are never returned to clients (debug off by default).
- **Secrets** — read from environment variables; nothing sensitive is hardcoded.
- **Request size** — capped at 1 MB to blunt trivial payload-based DoS.

## Project layout

```
config.py            # env-driven configuration
run.py               # dev entry point (port 5064)
requirements.txt
app/
  __init__.py        # app factory, extensions, security headers, error handlers
  models.py          # SQLAlchemy models (User, Project, Membership, Task)
  forms.py           # WTForms (validation + CSRF)
  auth.py            # register / login / logout
  projects.py        # projects, members, tasks, board (access control here)
  main.py            # index + health check
  templates/         # Jinja2 templates (auto-escaped)
  static/style.css
```

## Production notes

Use a WSGI server instead of the dev server, e.g.:

```bash
pip install gunicorn
gunicorn -b 0.0.0.0:5064 "app:create_app()"
```
