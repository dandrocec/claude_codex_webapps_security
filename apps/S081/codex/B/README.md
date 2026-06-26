# Flask Voting Platform

A SQLite-backed Flask app where admins create elections, registered users vote once per election, and results appear only after closing time.

## Run locally on port 5081

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SECRET_KEY = "replace-with-a-long-random-secret"
$env:ADMIN_EMAIL = "admin@example.com"
$env:ADMIN_PASSWORD = "replace-with-a-12-character-minimum-password"
$env:COOKIE_SECURE = "false"
python app.py
```

Open `http://127.0.0.1:5081`.

For production, use HTTPS, keep `COOKIE_SECURE=true`, provide strong environment-managed secrets, and run behind a production WSGI server.
