# Flask Recruitment Portal

A small recruitment portal built with Flask, SQLite, bcrypt password hashing, CSRF protection, secure headers, role-based access control, and hardened resume uploads.

## Run locally on port 5085

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SECRET_KEY = "replace-with-a-long-random-secret"
flask --app app run --host 127.0.0.1 --port 5085
```

Open `http://127.0.0.1:5085`.

For production, use HTTPS and keep `SESSION_COOKIE_SECURE=true`. If you need to test over plain local HTTP, set `SESSION_COOKIE_SECURE=false` before starting Flask.
