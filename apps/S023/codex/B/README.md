# Secure Flask Pastebin

A small Flask pastebin that stores user-owned pastes in SQLite. Users register, create a paste, and receive a unique `/p/<token>` URL for viewing it.

## Run locally on port 5023

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
export SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
export PASTEBIN_COOKIE_SECURE=false
flask --app app run --host 127.0.0.1 --port 5023
```

On Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SECRET_KEY = python -c "import secrets; print(secrets.token_urlsafe(32))"
$env:PASTEBIN_COOKIE_SECURE = "false"
flask --app app run --host 127.0.0.1 --port 5023
```

Open `http://127.0.0.1:5023`.

For production, serve behind HTTPS and leave `PASTEBIN_COOKIE_SECURE` unset so session cookies require TLS.
