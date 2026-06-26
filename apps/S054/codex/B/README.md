# Flask Time Tracker

A small Flask and SQLite time-tracking app with registration, login, per-user time entries, and weekly project totals.

## Run locally on port 5054

Create a virtual environment, install dependencies, set a strong secret, then run:

```bash
pip install -r requirements.txt
export SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
export FLASK_RUN_PORT=5054
flask --app app run --port 5054
```

On Windows PowerShell:

```powershell
pip install -r requirements.txt
$env:SECRET_KEY = python -c "import secrets; print(secrets.token_urlsafe(32))"
$env:FLASK_RUN_PORT = "5054"
flask --app app run --port 5054
```

The SQLite database is created automatically as `time_tracker.sqlite3`. Override it with `DATABASE_PATH` if needed.

Secure cookies are enabled by default. For plain HTTP-only local development, set `SESSION_COOKIE_SECURE=false`; keep it enabled in production behind HTTPS.
