# Admin Dashboard

A small admin dashboard web application built with **Flask** and **SQLite**.

## Features

- **Admin login** — session-based authentication (only active admins may log in).
- **Dashboard** — site statistics (total / active / inactive users, admin count) plus a list of all users.
- **User management** — create, edit, and deactivate/reactivate user accounts.
- **Database** — all data persisted in a local SQLite file (`admin_dashboard.db`), created and seeded automatically on first run.

## Requirements

- Python 3.9+

## Run locally (port 5086)

```bash
# 1. (optional) create a virtual environment
python -m venv venv
# Windows:
venv\Scripts\activate
# macOS / Linux:
source venv/bin/activate

# 2. install dependencies
pip install -r requirements.txt

# 3. start the app
python app.py
```

Then open <http://127.0.0.1:5086> in your browser.

On first launch the database is created and seeded with a default admin and a few
demo users.

## Default login

| Username | Password   | Role  |
|----------|------------|-------|
| `admin`  | `admin123` | Admin |

Demo non-admin users (`alice`, `bob`, `carol`) use the password `password123`.
Only admin accounts can log in to the dashboard.

## Project layout

```
app.py              # Flask app: models, routes, DB seeding
requirements.txt    # Python dependencies
templates/          # Jinja2 templates (login, dashboard, user form)
static/style.css    # Styling
admin_dashboard.db  # SQLite database (auto-created on first run)
```

## Notes

- To reset all data, stop the app and delete `admin_dashboard.db`; it will be
  recreated and re-seeded on the next run.
- For production, set a real secret key via the `SECRET_KEY` environment variable
  and run behind a WSGI server (e.g. gunicorn/waitress) instead of the built-in
  development server.
```
