# Flask Time Tracker

A small Flask app for tracking time by project. Users can register, log in, create time entries, and view weekly totals. Data is stored in SQLite, and each user only sees their own entries.

## Run locally

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open http://localhost:5054 in your browser.

The app creates `time_tracker.sqlite3` automatically on first run.
