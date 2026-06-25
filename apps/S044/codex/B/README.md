# Contact Form App

A small Flask contact form with SQLite storage, an admin message list, CSRF protection, bcrypt admin passwords, security headers, and SSRF checks for website previews.

## Run locally on port 5044

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SECRET_KEY = "replace-with-a-long-random-secret"
$env:ADMIN_USERNAME = "admin"
$env:ADMIN_PASSWORD = "replace-with-a-strong-password"
$env:SESSION_COOKIE_SECURE = "false"
python app.py
```

Open `http://127.0.0.1:5044`.

For production behind HTTPS, leave `SESSION_COOKIE_SECURE` unset or set it to `true`, and provide a persistent `SECRET_KEY`. The first startup creates the admin user only when `ADMIN_PASSWORD` is set and no admin exists yet.
