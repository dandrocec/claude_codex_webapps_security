# Tiny Flask Greeting App

This is a minimal Flask app with one form field. Submit a name and the app redirects to a greeting page.

## Run Locally on Port 5001

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SECRET_KEY = "replace-with-a-long-random-value"
$env:FLASK_ENV = "development"
python app.py
```

Open http://127.0.0.1:5001 in your browser.

## Security Notes

- CSRF protection is enabled on the form with Flask-WTF.
- Input is validated, length-limited, whitespace-normalised, and rendered with Jinja's context-aware escaping.
- Session cookies are configured as HttpOnly, SameSite=Lax, and Secure outside local development.
- Security headers are set on every response.
- Generic error pages avoid leaking stack traces or internals to clients.
- The secret key is read from the `SECRET_KEY` environment variable and is never hardcoded.
- There is no database, so there are no SQL queries. If database access is added later, use parameterised queries or an ORM with bound parameters.
- There are no passwords or user accounts. If authentication is added later, hash passwords with bcrypt or Argon2.
- There are no per-user resources beyond the current browser session, so IDOR-style access control is not applicable here. If user-owned resources are added later, check ownership server-side on every access.
