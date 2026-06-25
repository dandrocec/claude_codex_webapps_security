# Secure FastAPI File Upload App

A small FastAPI application with registration, login, CSRF-protected uploads, per-user file ownership, and secure download links.

## Run locally on port 5010

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
set APP_SECRET_KEY=replace-with-a-long-random-secret
set COOKIE_SECURE=false
uvicorn app.main:app --host 127.0.0.1 --port 5010
```

Open `http://127.0.0.1:5010`.

`COOKIE_SECURE=false` is only for plain HTTP local development. In production, leave it unset or set it to `true` so session cookies use the `Secure` flag.

## Configuration

- `APP_SECRET_KEY`: required signing secret for sessions and CSRF tokens.
- `COOKIE_SECURE`: defaults to `true`; set to `false` only for local HTTP testing.
- `DATABASE_PATH`: optional SQLite database path, default `app.db`.
- `UPLOAD_DIR`: optional upload directory, default `uploads`.
- `MAX_UPLOAD_BYTES`: optional max file size, default `5242880` bytes.

Allowed upload types are PNG, JPEG, GIF, PDF, and UTF-8 text files. Files are validated by inspected content, stored under random server-generated names, and can only be downloaded by the user who uploaded them.
