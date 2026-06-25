# Flask Wiki

A small Flask wiki where anyone can read pages, and registered users can create and edit only their own pages. Pages are stored in SQLite and Markdown is sanitized before display.

## Run locally

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SECRET_KEY = "replace-with-a-long-random-secret"
$env:PORT = "5036"
python app.py
```

Open `http://127.0.0.1:5036`.

Optional: set `DATABASE_URL` to choose a different SQLite file path.
