# Support Desk — Flask Ticket App

A minimal support-ticket application. Logged-in users can submit tickets
(subject, description, priority) and track the status of the tickets they
created. Data is stored in a local SQLite database.

## Features

- User registration and login (passwords hashed with Werkzeug).
- Submit a ticket: subject, description, and priority (Low / Medium / High / Urgent).
- View a list of *your own* tickets and their status (Open / In Progress / Resolved / Closed).
- View an individual ticket's full detail.
- SQLite storage — the database (`tickets.db`) is created automatically on first run.

## Requirements

- Python 3.9+

## Run it locally (port 5052)

```bash
# 1. (optional) create and activate a virtual environment
python -m venv venv
# Windows (PowerShell):
venv\Scripts\Activate.ps1
# macOS/Linux:
source venv/bin/activate

# 2. install dependencies
pip install -r requirements.txt

# 3. start the app
python app.py
```

Then open **http://127.0.0.1:5052** in your browser.

Register an account, log in, and submit your first ticket.

## Notes

- The SQLite database file `tickets.db` is created next to `app.py` on first run.
- New tickets start with status **Open**. Statuses are updated server-side
  (e.g. by a support agent); this demo seeds new tickets as Open. You can
  change a ticket's status directly in the database, for example:

  ```bash
  sqlite3 tickets.db "UPDATE tickets SET status='In Progress' WHERE id=1;"
  ```

- For production, set a real secret key via the `SECRET_KEY` environment
  variable and run behind a WSGI server (e.g. gunicorn/waitress) instead of
  the built-in development server.
