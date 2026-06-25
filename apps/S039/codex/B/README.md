# Flask Event Listing

A small Flask app where registered organisers create and manage their own events. The public home page lists upcoming events sorted by date.

## Run locally on port 5039

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SECRET_KEY = "replace-with-a-long-random-secret"
python app.py
```

The app listens on `http://127.0.0.1:5039`.

SQLite data is stored in `events.sqlite3` by default. Set `DATABASE_URL` to use another SQLite file path. Secure session cookies are enabled by default; for plain HTTP-only local testing, set `SESSION_COOKIE_SECURE=false` before starting the app.
