# Flask Invoicing App

A small multi-user invoicing application. Each user registers an account and can
manage their own **clients** and **invoices**. Invoices have any number of line
items; the app computes the subtotal, tax, and grand total automatically and can
render a clean, printable invoice (print to paper or "Save as PDF" from the
browser dialog). All data is isolated per user — you only ever see your own
clients and invoices.

## Features

- Email/password authentication (passwords hashed with Werkzeug)
- Per-user data isolation enforced on every route
- CRUD for clients
- Create/edit invoices with a dynamic line-item editor (live totals in the browser)
- Server-side total + tax computation using `Decimal` (no floating-point cents drift)
- Invoice statuses: draft / sent / paid
- Printable invoice page (`/invoices/<id>/print`)
- SQLite storage (single file, created automatically on first run)

## Tech stack

- Flask 3
- Flask-SQLAlchemy (SQLite)
- Flask-Login
- Plain HTML/CSS/JS templates (no build step)

## Requirements

- Python 3.9+

## Run locally (port 5079)

```bash
# 1. (recommended) create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS / Linux:
source .venv/bin/activate

# 2. install dependencies
pip install -r requirements.txt

# 3. start the app
python app.py
```

Then open <http://127.0.0.1:5079> in your browser.

On first launch the SQLite database (`invoicing.db`) is created automatically in
the project directory. Register a new account, add a client, then create your
first invoice.

## Project layout

```
app.py                  application factory, routes, form handling
models.py               SQLAlchemy models + Decimal money helpers
requirements.txt        Python dependencies
templates/              Jinja2 templates (base layout, auth, clients, invoices, print)
static/style.css        styling
invoicing.db            SQLite database (auto-created, not committed)
```

## Notes

- The app runs in debug mode for convenience. For a real deployment, set a strong
  `SECRET_KEY` environment variable and run behind a production WSGI server
  (e.g. `gunicorn "app:app"`) with debug disabled.
- To reset all data, stop the app and delete `invoicing.db`.
