# Flask Notes App

A small Flask application for registering, logging in, and managing personal notes stored in SQLite.

## Run locally

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5028 in your browser.

The SQLite database is created automatically as `notes.db` the first time the app runs.
