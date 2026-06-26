# Flask Scheduling App

A small scheduling app where providers publish available appointment slots and clients book open slots. SQLite stores all data, and the database prevents the same slot from being booked twice.

## Run locally

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5068 in your browser.

The SQLite database is created automatically as `scheduler.sqlite3` on first run.
