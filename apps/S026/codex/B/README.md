# Flask Blog

A small Flask blog application with user registration, login, SQLite storage, CSRF protection, bcrypt password hashing, ownership checks for post edits/deletes, secure headers, and safe template escaping.

## Run locally on port 5026

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
$env:SECRET_KEY = "replace-with-a-long-random-secret"
$env:SESSION_COOKIE_SECURE = "false"
python app.py
```

Open http://127.0.0.1:5026.

For production, use HTTPS and leave `SESSION_COOKIE_SECURE` enabled or set it to `true`. You can set `DATABASE` to choose a different SQLite database path.
