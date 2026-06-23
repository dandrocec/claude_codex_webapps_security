# Job Runner

A small FastAPI application where logged-in users submit a script or command,
the server executes it, captures the combined output, and shows a per-user
history of jobs with their status and logs. Job metadata is stored in a SQL
database (SQLite by default).

## ⚠️ Important security note about what this app does

Running user-supplied commands is **the explicit purpose** of this tool, which
means it is effectively authenticated remote code execution scoped to the
privileges of the server process. The application applies the controls below to
contain the blast radius, but **for any real deployment you must additionally
sandbox execution**: run inside a locked-down container as an unprivileged
user, with no privileged mounts, restricted network, and resource limits
(cgroups / seccomp / AppArmor). Never run the server as root.

## Requirements

- Python 3.10+

## Run locally on port 5095

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS/Linux:
source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env          # Windows: copy .env.example .env
#   - set a strong SECRET_KEY (python -c "import secrets; print(secrets.token_urlsafe(48))")
#   - keep COOKIE_SECURE=false for local http testing

# 4. Start the server on port 5095
uvicorn app.main:app --host 127.0.0.1 --port 5095
```

Then open <http://127.0.0.1:5095/>, register an account, and submit a job.

> The database tables are created automatically on first start
> (`jobrunner.db` by default).

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `SECRET_KEY` | _(generated, ephemeral)_ | Server secret. **Set this** in production. |
| `DATABASE_URL` | `sqlite:///./jobrunner.db` | SQLAlchemy database URL. |
| `COOKIE_SECURE` | `true` | Mark session cookie `Secure`. Set `false` only for local http. |
| `SESSION_TTL_SECONDS` | `43200` | Session lifetime. |
| `JOB_TIMEOUT_SECONDS` | `300` | Per-job wall-clock timeout. |
| `MAX_OUTPUT_BYTES` | `262144` | Max stored output per job. |
| `HOST` / `PORT` | `127.0.0.1` / `5095` | Bind address. |

## How the security requirements are addressed (OWASP Top 10)

- **A01 Broken Access Control / IDOR** — every job query is filtered by the
  authenticated user's id; viewing or deleting another user's job returns 404.
  Authentication is required for all job routes.
- **A02 Cryptographic Failures** — passwords are hashed with **Argon2id**
  (per-user salt + parameters embedded in the hash). Session cookies are
  `HttpOnly`, `Secure`, `SameSite=Lax`. Session state is server-side; the
  cookie holds only an opaque random token.
- **A03 Injection** — all database access uses the SQLAlchemy ORM with bound
  parameters (no string-built SQL). HTML output is rendered through Jinja2 with
  autoescaping for context-aware output encoding (XSS protection).
- **A04 Insecure Design** — job execution is bounded by a timeout and output
  cap, runs with a minimal environment, and the README documents the required
  sandboxing for real deployments.
- **A05 Security Misconfiguration** — a strict set of security headers is sent
  on every response (CSP, `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, COOP/CORP, and HSTS over HTTPS).
  Interactive API docs (`/docs`, `/redoc`, OpenAPI) are disabled.
- **A07 Identification & Authentication Failures** — generic login errors
  (no username enumeration), constant-ish work on failed logins, minimum
  password length, and session expiry.
- **CSRF** — all state-changing requests (`POST` for register/login excluded
  pre-auth, and logout, job create, job delete) require a per-session
  synchronizer token compared in constant time, layered with `SameSite` cookies.
- **Input validation** — usernames are validated against an allowlist regex,
  password length is bounded, and job name/command lengths are enforced.
- **Error handling** — unhandled exceptions are logged server-side only; clients
  get a generic error page with no stack traces or internal details.
- **Secrets** — read exclusively from environment variables; nothing sensitive
  is hardcoded.

## Project layout

```
app/
  config.py     # env-driven settings
  db.py         # SQLAlchemy engine/session
  models.py     # User, Session, Job
  security.py   # Argon2 hashing, sessions, CSRF, security headers
  runner.py     # background job execution
  main.py       # FastAPI routes + middleware
  templates/    # Jinja2 templates (autoescaped)
  static/       # stylesheet
requirements.txt
.env.example
```

## Notes

- Jobs run in a background thread and update their status
  (`pending → running → success/failed/timeout/error`). Reload the job page to
  see updated output.
- SQLite is the default for zero-config local runs; point `DATABASE_URL` at
  PostgreSQL/MySQL for production.
