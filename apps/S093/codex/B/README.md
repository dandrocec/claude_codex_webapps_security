# Flask Ledger

A small Flask and SQLite ledger where users can register, sign in, transfer funds, and view only their own transaction history.

## Run locally on port 5093

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:LEDGER_SECRET_KEY = "replace-with-a-long-random-secret"
python app.py
```

Open `http://127.0.0.1:5093`.

The app stores data in `ledger.sqlite3` by default. Set `LEDGER_DATABASE` to use another SQLite path. Session cookies are configured as HttpOnly, Secure, and SameSite=Lax; for a plain HTTP-only local browser that refuses Secure cookies, set `LEDGER_COOKIE_SECURE=0` only for local development.
