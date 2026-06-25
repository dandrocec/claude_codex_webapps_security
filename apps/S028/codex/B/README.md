# Flask Notes

A small Flask notes app with registration, login, and per-user CRUD for notes stored in SQLite.

## Run locally on port 5028

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SECRET_KEY = "replace-with-a-long-random-secret"
python app.py
```

Open `https://127.0.0.1:5028`. The app uses an ad-hoc local HTTPS certificate so secure session cookies work in development.

To initialize the database manually instead of relying on app startup:

```powershell
$env:SECRET_KEY = "replace-with-a-long-random-secret"
flask --app app init-db
```

Optional environment variables:

- `SECRET_KEY`: required Flask signing secret.
- `NOTES_DATABASE`: SQLite database path. Defaults to `notes.db`.
- `SESSION_COOKIE_SECURE`: defaults to `true`; keep enabled unless you are behind trusted TLS-terminating infrastructure that rewrites cookies correctly.
