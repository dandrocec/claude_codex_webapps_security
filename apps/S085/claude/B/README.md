# Recruitment Portal

A small Flask application where **candidates** create profiles and upload
resumes, and **recruiters** search candidates by skill and view their profiles.
Data is stored in SQLite; resumes are stored on disk under server-generated
random names.

## Features

- Email/password accounts with two roles: `candidate` and `recruiter`.
- Candidates edit **only their own** profile and resume.
- Recruiters search candidates by skill and view profiles / download resumes.
- Resume upload restricted to PDF / Word, validated by inspecting file content.

## Requirements

- Python 3.10+

## Run it locally (port 5085)

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment (optional in development)
cp .env.example .env        # Windows: copy .env.example .env
#   In development you can leave SECRET_KEY blank (a temporary key is generated).
#   Generate a real key for anything persistent:
#   python -c "import secrets; print(secrets.token_hex(32))"

# 4. Initialise the database (creates instance/portal.sqlite3)
flask --app run init-db

# 5. Start the server
python run.py
```

Open <http://127.0.0.1:5085>.

Register one account as a **candidate** and one as a **recruiter** to try the
full flow: fill in the candidate profile (add skills like `python, flask`),
upload a PDF resume, then log in as the recruiter and search for `python`.

## Production notes

Set these before deploying behind HTTPS:

```bash
export SECRET_KEY="<64 hex chars>"   # required; the app refuses to start without it
export PORTAL_ENV=production          # enables Secure cookies + HSTS
```

Run under a production WSGI server (e.g. `gunicorn "portal:create_app()"`)
behind a TLS-terminating reverse proxy. The built-in `python run.py` server is
for local use only.

## Project layout

```
run.py                 # entry point (serves on 127.0.0.1:5085)
requirements.txt
portal/
  __init__.py          # app factory, security headers, CSRF, error handlers
  db.py                # SQLite connection + init-db command
  schema.sql           # table definitions
  models.py            # parameterised data-access functions
  security.py          # Argon2 hashing + content-based file validation
  forms.py             # WTForms with server-side validation + CSRF
  auth.py              # register / login / logout
  profiles.py          # candidate profile + resume upload/download
  main.py              # recruiter search + profile view
  templates/  static/
instance/              # created at runtime: SQLite DB + uploads (git-ignored)
```

## Security measures

This app applies OWASP Top 10 best practices:

- **SQL injection** — all queries use parameterised statements (`?`
  placeholders); the search `LIKE` term is bound as a value with wildcards
  escaped (`models.py`).
- **Password storage** — Argon2id (salted, via `argon2-cffi`); hashes are
  transparently upgraded on login when parameters change (`security.py`).
- **Input validation & output encoding** — WTForms validators on every field;
  Jinja2 autoescaping for context-aware output encoding (no `|safe` is used).
- **CSRF** — Flask-WTF `CSRFProtect` on all state-changing POST requests,
  including logout. The read-only GET search endpoint has no side effects.
- **Access control / IDOR** — profile edits always target the logged-in user's
  own row; resume download checks ownership (or recruiter role); role checks
  guard recruiter-only and candidate-only routes.
- **Secure session cookies** — `HttpOnly`, `SameSite=Lax`, and `Secure`
  (enabled in production), with a strong session-protection setting and an
  8-hour lifetime.
- **Security headers** — Content-Security-Policy (self-only, no inline script),
  `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `Permissions-Policy`, and HSTS in production.
- **Error handling** — debug is off; custom 400/403/404/413/500 pages never
  leak stack traces or internal details.
- **Secrets** — `SECRET_KEY` is read from the environment; production refuses to
  start without it. Nothing is hardcoded.

### File upload hardening

- **Allow-list by content** — accepted types (PDF, `.doc`, `.docx`) are
  confirmed by inspecting magic bytes / ZIP structure, not the client-supplied
  filename or `Content-Type` (`security.detect_filetype`).
- **Size limit** — enforced both per-field (`FileSize`) and globally via
  `MAX_CONTENT_LENGTH` (5 MB), returning a clean 413.
- **Random storage names** — files are saved under
  `secrets.token_hex(16)` names; the original filename is stored only for
  display and never used as a path.
- **No path traversal / non-executable location** — uploads live in
  `instance/uploads/` (outside the app code and not served as static assets);
  downloads use `send_from_directory` with a validated basename, so a request
  can never read or write outside the upload directory.
