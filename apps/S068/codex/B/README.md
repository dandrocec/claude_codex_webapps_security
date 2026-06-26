# Flask Scheduling App

A small scheduling app where providers publish available slots and clients book open slots. Data is stored in SQLite.

## Run locally on port 5068

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SECRET_KEY = "replace-with-a-long-random-secret"
python app.py
```

Open `https://127.0.0.1:5068`. The app uses an ad-hoc local TLS certificate by default so secure cookies work during local development.

To initialize the database without starting the app:

```powershell
$env:SECRET_KEY = "replace-with-a-long-random-secret"
flask --app app init-db
```

## Notes

- Set `SECRET_KEY` from the environment; the app refuses to start without it.
- SQLite is stored at `scheduler.sqlite3` by default. Override with `DATABASE_URL`.
- State-changing requests use CSRF protection.
- Passwords are hashed with bcrypt.
- The app uses parameterized SQLite queries, role checks, ownership checks, secure cookie settings, and security headers.
