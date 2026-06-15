# Flask Notes App

A small multi-user notes application. Users register and log in, then create,
edit, and delete their own personal notes (title + body). Each user sees only
their own notes. Data is stored in a local SQLite database (`notes.db`).

## Features

- User registration and login (passwords stored hashed via Werkzeug)
- Session-based authentication
- Create / edit / delete notes
- Notes list scoped to the logged-in user
- SQLite storage (auto-created on first run)

## Requirements

- Python 3.9+

## Run locally

```bash
# 1. (optional) create and activate a virtual environment
python -m venv venv
# Windows (PowerShell):
venv\Scripts\Activate.ps1
# macOS / Linux:
source venv/bin/activate

# 2. install dependencies
pip install -r requirements.txt

# 3. start the app
python app.py
```

The app runs on **http://127.0.0.1:5028**.

Open that URL, register an account, and start adding notes.

## Notes

- The SQLite database file `notes.db` is created automatically in the project
  directory on first launch.
- For production, set a real secret key via the `SECRET_KEY` environment
  variable instead of relying on the built-in development default.
