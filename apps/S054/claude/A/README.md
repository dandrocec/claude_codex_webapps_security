# Time Tracker

A small Flask app for logging work time and reviewing weekly totals.

- Register / log in (passwords are hashed).
- Record time entries: **project, date, hours, note**.
- View totals grouped by week and by project.
- Every user sees **only their own** entries.
- Data is stored in a local **SQLite** database (`timetracker.db`, created on first run).

## Requirements

- Python 3.9+

## Run it locally (port 5054)

```bash
# 1. From the project directory, create and activate a virtual environment
python -m venv venv

# macOS / Linux
source venv/bin/activate
# Windows (PowerShell)
venv\Scripts\Activate.ps1

# 2. Install dependencies
pip install -r requirements.txt

# 3. Start the app
python app.py
```

Then open <http://127.0.0.1:5054> in your browser, register an account, and start logging time.

The SQLite database is created automatically on first run. To start fresh, stop the
app and delete `timetracker.db`.

## Notes

- `SECRET_KEY` defaults to a development value. For anything beyond local use, set
  your own: `export SECRET_KEY="..."` (or `$env:SECRET_KEY="..."` on Windows) before
  starting the app.
