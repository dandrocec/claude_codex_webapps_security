# Flask Recruiting App

A small recruiting application with employer job posts, applicant submissions, resume uploads, and SQLite storage.

## Run locally on port 5070

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SECRET_KEY = (python -c "import secrets; print(secrets.token_urlsafe(32))")
$env:SESSION_COOKIE_SECURE = "false"
python app.py
```

Open `http://127.0.0.1:5070`.

For HTTPS deployments, leave `SESSION_COOKIE_SECURE` unset or set it to `true`. Uploaded resumes are stored under `instance/uploads` using random server-generated names.
