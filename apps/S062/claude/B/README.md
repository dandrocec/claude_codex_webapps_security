# Helpdesk (Flask + SQLite)

A small, security-hardened helpdesk.

- **Customers** register, open tickets, and reply on their own tickets.
- **Agents** see every ticket, assign tickets to an agent, change status
  (`open → pending → resolved → closed`), and reply.
- Customers can only ever see and act on **their own** tickets.

Data is stored in a local SQLite database. All queries are parameterised.

## Requirements

- Python 3.9+

## Run it locally (port 5062)

```bash
# 1. (optional) create a virtual environment
python -m venv .venv
# Windows PowerShell:
.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate

# 2. install dependencies
pip install -r requirements.txt

# 3. configure secrets
cp .env.example .env            # Windows: copy .env.example .env
#   then edit .env and set SECRET_KEY (see the comment in the file)

# 4. create the database + demo accounts
python seed.py

# 5. start the server on port 5062
python app.py
```

Open <http://127.0.0.1:5062>.

> The dev server binds to `127.0.0.1`. Because the demo runs over plain HTTP,
> leave `FLASK_DEBUG=false` for production-like behaviour, or set it to `true`
> locally (which automatically relaxes the `Secure` cookie flag so login works
> over HTTP). Behind real HTTPS, keep Secure cookies on (the default).

### Demo accounts

| Role     | Email                  | Password         |
|----------|------------------------|------------------|
| Agent    | `agent@example.com`    | `AgentPass123`   |
| Customer | `customer@example.com` | `CustomerPass123`|

Self-registration always creates a **customer**. Provision agents via
`seed.py` (or insert a row with `role = 'agent'`).

## Project layout

```
app.py        Application factory, security headers, error handlers
auth.py       Register / login / logout
tickets.py    Ticket list, create, view, reply, status, assign
forms.py      WTForms (validation + CSRF)
security.py   Argon2 password hashing, auth/role decorators
db.py         SQLite connection + `flask init-db`
schema.sql    Tables
seed.py       Init DB + demo users
templates/    Jinja2 templates (auto-escaped)
static/       CSS
```

## Security measures (OWASP Top 10)

| Area | What we do |
|------|-----------|
| **SQL injection** | Every statement uses parameterised `?` placeholders; no string-built SQL. |
| **Password storage** | Argon2id (salted, memory-hard) via `argon2-cffi`; transparent rehash on login. |
| **Broken access control / IDOR** | Ownership checked server-side against the session user id; non-owners get `404`. Agent-only actions guarded by `role_required`. |
| **XSS** | Jinja2 auto-escaping everywhere; strict `Content-Security-Policy` (no inline scripts); user text rendered with `white-space: pre-wrap`, never `|safe`. |
| **CSRF** | `Flask-WTF` `CSRFProtect` on all POST requests; tokens on every form, including logout. |
| **Input validation** | WTForms validators (required, length, email, allowed-value regex) reject bad input before it reaches the DB. |
| **Session security** | Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` (auto-relaxed only in debug); session is cleared/regenerated on login to prevent fixation. |
| **Security headers** | CSP, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and HSTS when served over HTTPS. |
| **Error handling** | Custom 400/403/404/413/500 pages; stack traces are logged server-side, never sent to clients (debug off by default). |
| **Secrets management** | `SECRET_KEY` and DB path come from environment variables / `.env`; nothing secret is hardcoded. |
| **Auth hardening** | Generic login errors and constant-work verification reduce user enumeration; open-redirect-safe `next` handling. |

## Resetting

Delete `helpdesk.db` and re-run `python seed.py`.
