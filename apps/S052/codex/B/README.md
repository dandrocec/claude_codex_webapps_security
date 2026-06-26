# Flask Support Tickets

A small Flask app where registered users can submit support tickets and view only their own ticket status.

## Run locally on port 5052

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SECRET_KEY = "replace-with-a-long-random-secret"
$env:SESSION_COOKIE_SECURE = "false"
python app.py
```

Open `http://127.0.0.1:5052`.

The `SESSION_COOKIE_SECURE=false` setting is for plain HTTP local testing only. Without that override, the app defaults to secure session cookies.

```powershell
$env:SESSION_COOKIE_SECURE = "true"
```

Optional configuration:

```powershell
$env:DATABASE_PATH = "support_tickets.db"
```

The SQLite database is created automatically on startup.
