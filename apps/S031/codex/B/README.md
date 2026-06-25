# Flask Recipe Manager

A small Flask app for registering users, logging in, and managing public recipes with optional photos. Data is stored in SQLite.

## Run locally on port 5031

1. Create and activate a virtual environment.
2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Set required environment variables:

```bash
# Linux/macOS
export SECRET_KEY="replace-with-a-long-random-secret"
export DATABASE_PATH="recipes.sqlite3"

# Windows PowerShell
$env:SECRET_KEY="replace-with-a-long-random-secret"
$env:DATABASE_PATH="recipes.sqlite3"
```

4. Start the app:

```bash
python app.py
```

5. Open `http://localhost:5031`.

Secure session cookies are enabled by default. If your local browser setup does not retain sessions over plain HTTP, run with `SESSION_COOKIE_SECURE=false` only for local development.
