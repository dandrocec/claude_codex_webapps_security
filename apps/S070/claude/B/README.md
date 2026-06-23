# Recruiting App (Flask + SQLite)

A small recruiting platform:

- **Employers** post jobs and review applications **for their own jobs only**,
  and can update each application's status.
- **Applicants** browse jobs, apply with a cover letter, and upload a resume.
  They see **only their own** submissions.

Data is stored in a local SQLite database. Uploaded resumes are stored on disk
under server-generated random filenames.

## Requirements

- Python 3.11+ (uses `X | None` type syntax)
- pip

## Run locally on port 5070

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Provide a secret (recommended). Copy the example env file:
#    cp .env.example .env   # then edit SECRET_KEY
#    Or set it inline for one run:
# PowerShell:
$env:SECRET_KEY = python -c "import secrets; print(secrets.token_hex(32))"
# bash:
# export SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")

# 4. Start the app
python app.py
```

Then open <http://127.0.0.1:5070>.

The database (`recruiting.sqlite3`) and the `uploads/` directory are created
automatically on first run.

> If `SECRET_KEY` is not set, a random ephemeral key is generated per run.
> The app still works, but sessions will not survive a restart. Always set a
> stable `SECRET_KEY` in any real deployment.

## Try it

1. Register an **employer** account, then post a job.
2. In another browser (or after logging out), register an **applicant**
   account, open the job, and apply with a PDF/DOC/DOCX resume.
3. Log back in as the employer to review the application and download the
   resume.

## Configuration (environment variables)

| Variable                | Default               | Purpose                                              |
|-------------------------|-----------------------|------------------------------------------------------|
| `SECRET_KEY`            | random per run        | Signs session cookies / CSRF tokens. Set in prod.    |
| `PORT`                  | `5070`                | Listen port.                                         |
| `SESSION_COOKIE_SECURE` | `false`               | Set `true` behind HTTPS to enable Secure cookies + HSTS. |
| `DATABASE_PATH`         | `./recruiting.sqlite3`| SQLite file location.                                |
| `UPLOAD_DIR`            | `./uploads`           | Where resumes are stored (outside the web root).     |
| `MAX_UPLOAD_BYTES`      | `5242880` (5 MiB)     | Maximum request/upload size.                         |

## Security measures

Mapped to the mandatory requirements / OWASP Top 10:

- **SQL injection** — every query uses bound parameters (`?` placeholders);
  no string-built SQL (`db.py`, `app.py`).
- **Password storage** — Argon2id (salted, memory-hard) via `argon2-cffi`;
  hashes are transparently upgraded when parameters change.
- **Input validation** — WTForms validators on all fields (length, email,
  enum constraints).
- **XSS** — Jinja2 auto-escaping provides context-aware output encoding;
  user content is never marked safe. A strict Content-Security-Policy with no
  inline scripts is sent on every response.
- **CSRF** — Flask-WTF `CSRFProtect` enforces a token on every state-changing
  POST (login, register, post job, apply, status update, logout).
- **Access control / IDOR** — every job, application, status update and resume
  download is scoped to the authenticated owner (employer owns the job;
  applicant owns the application). Cross-user access returns `403`.
- **Session cookies** — `HttpOnly`, `SameSite=Lax`, and `Secure`
  (enabled via `SESSION_COOKIE_SECURE` when on HTTPS).
- **Security headers** — CSP, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy`, and HSTS under HTTPS.
- **Error handling** — custom 400/403/404/413/500 pages; debug is forced off,
  so stack traces and internals are never sent to clients.
- **Secrets** — read from environment variables; nothing secret is hard-coded.

### File upload hardening

- **Allow-list by content** — only PDF, DOC and DOCX are accepted, detected by
  inspecting magic bytes / container shape (`uploads.py`), not the client
  filename or `Content-Type`. DOCX is verified to be a real OOXML ZIP.
- **Size limit** — enforced globally via `MAX_CONTENT_LENGTH`; oversized
  uploads get a clean `413`.
- **Random storage names** — files are saved as `uuid4().hex.<ext>`; the
  user-supplied filename never touches the filesystem.
- **No path traversal** — the storage path is resolved with `realpath` and
  verified to stay inside `UPLOAD_DIR` on both write and read; downloads are
  served via `send_file` as attachments (never executed/inlined).
- **Not served as code** — uploads live outside the static/template roots and
  are only reachable through the access-controlled download route.

## Project layout

```
app.py            # Flask app factory, routes, auth, security headers
config.py         # Configuration from environment variables
db.py             # SQLite connection helpers (parameterised queries)
uploads.py        # Resume validation & safe storage
forms.py          # WTForms definitions (validation + CSRF)
schema.sql        # Database schema
templates/        # Jinja2 templates (auto-escaped)
static/style.css  # Styles (kept external for a strict CSP)
```
