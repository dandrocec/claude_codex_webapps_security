# Image Resizer

A small Flask web app that resizes images. After logging in, a user uploads an
image and chooses a target width; the app produces a resized thumbnail and shows
it with a download link. Thumbnails are private to the user who created them.

## Features

- Register / log in / log out
- Upload an image and pick a target width (1–5000 px, never upscaled)
- View the generated thumbnail and download it
- A list of your past thumbnails, each deletable

## Requirements

- Python 3.10+

## Run it locally (port 5011)

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.\.venv\Scripts\Activate.ps1
# macOS / Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment (copy the example and fill SECRET_KEY)
copy .env.example .env        # Windows
# cp .env.example .env        # macOS / Linux
```

Set the environment variables, then start the app. The app reads `PORT`
(defaults to **5011**).

**Windows (PowerShell):**
```powershell
$env:SECRET_KEY = python -c "import secrets; print(secrets.token_hex(32))"
$env:SECURE_COOKIES = "false"   # needed for plain-HTTP localhost
$env:PORT = "5011"
python app.py
```

**macOS / Linux (bash):**
```bash
export SECRET_KEY="$(python -c 'import secrets; print(secrets.token_hex(32))')"
export SECURE_COOKIES=false      # needed for plain-HTTP localhost
export PORT=5011
python app.py
```

Then open <http://127.0.0.1:5011>.

> **Why `SECURE_COOKIES=false` locally?** Session cookies are marked `Secure` by
> default, so browsers only send them over HTTPS. On plain-HTTP localhost the
> cookie would be withheld and login would silently fail. Leave the flag unset
> (defaults to `true`) for any real HTTPS deployment.

The SQLite database and uploaded files are created automatically under
`instance/` on first run.

## Security notes

This demo applies OWASP Top 10 best practices:

| Area | Approach |
|------|----------|
| SQL injection | `sqlite3` parameterised queries everywhere; no string-built SQL |
| Password storage | Argon2id (`argon2-cffi`) with per-user salt + auto-rehash |
| XSS | Jinja2 autoescaping, strict Content-Security-Policy, no raw HTML sinks |
| CSRF | `Flask-WTF` `CSRFProtect` token on every state-changing POST |
| Access control (IDOR) | every image view/download/delete checks `owner_id` |
| Sessions | cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` (configurable) |
| Security headers | CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, HSTS |
| Error handling | generic error pages; tracebacks are logged, never sent to clients |
| Secrets | `SECRET_KEY` read from the environment; nothing hardcoded |

### Upload hardening

- **Allow-list by content, not filename.** Uploads are decoded with Pillow
  (`Image.verify()` then a real load); only `JPEG`, `PNG`, `GIF`, `WEBP` are
  accepted. The client filename and `Content-Type` are never trusted.
- **Size cap.** Request bodies over 8 MiB are rejected (`MAX_CONTENT_LENGTH`),
  and oversized canvases are refused as a decompression-bomb guard.
- **Random server-generated names.** Files are stored as `uuid4().hex` plus a
  canonical extension. The original filename is sanitised and kept for display
  only — never used as a path.
- **Stored outside the web root.** Uploads live in `instance/uploads/`, which is
  not served statically and is never executed. Files are streamed back only
  through ownership-checked routes.
- **No path traversal.** Stored paths are resolved and confirmed to sit directly
  inside the upload directory before any read or write.

## Project layout

```
app.py              # application, routes, DB, image processing
requirements.txt    # dependencies
.env.example        # environment variable template
templates/          # Jinja2 templates (autoescaped)
instance/           # created at runtime: SQLite DB + uploaded files (gitignored)
```
