# Flask Wiki

A small SQLite-backed wiki with viewer/editor roles, editor-only pages, full revision history, and restore support.

## Run locally on port 5077

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SECRET_KEY = "replace-with-a-long-random-secret"
$env:SESSION_COOKIE_SECURE = "false"
flask --app app run --host 127.0.0.1 --port 5077
```

Open `http://127.0.0.1:5077`. Register the first account to create the initial editor user; later registrations are viewers.

For production, set a strong `SECRET_KEY`, keep `SESSION_COOKIE_SECURE=true`, run behind HTTPS, and store the SQLite database outside temporary storage with `WIKI_DB`.
