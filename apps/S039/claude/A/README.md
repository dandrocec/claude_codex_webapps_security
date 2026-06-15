# Event Listing App

A small Flask application for listing events. Logged-in users create events
(title, date, location, description); a public home page lists all **upcoming**
events sorted by date. Organisers can edit and delete only their own events.
Data is stored in a local SQLite database.

## Features

- Public listing of upcoming events, sorted soonest-first.
- User registration and login (passwords are hashed).
- Authenticated users create, edit and delete events.
- Each organiser can only manage the events they created.
- "My events" page for managing your own events.

## Requirements

- Python 3.9+

## Run it locally (port 5039)

```bash
# 1. From the project directory, create and activate a virtual environment
python -m venv .venv

# macOS / Linux
source .venv/bin/activate
# Windows (PowerShell)
.venv\Scripts\Activate.ps1

# 2. Install dependencies
pip install -r requirements.txt

# 3. Start the app
python app.py
```

Then open <http://127.0.0.1:5039> in your browser.

The SQLite database (`events.db`) is created automatically on first run.

## Usage

1. Click **Register** to create an account.
2. Use **New event** to add an event.
3. Visit the home page (any visitor, logged in or not) to see upcoming events.
4. Use **My events** to edit or delete the events you organise.

## Project layout

```
app.py              Application factory, routes and form handling
models.py           SQLAlchemy models (User, Event)
templates/          Jinja2 templates
static/style.css    Styling
requirements.txt    Python dependencies
```

## Notes

- `SECRET_KEY` is hard-coded for local development. Set a real secret via the
  environment before deploying anywhere public.
