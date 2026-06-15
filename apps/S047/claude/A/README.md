# Inventory Tracker

A small Flask application for tracking inventory. Logged-in users can add
items (name, SKU, quantity, location), adjust quantities up or down, and
search across name / SKU / location. Items at or below their per-item
low-stock threshold are highlighted in the list. Data is stored in a local
SQLite database.

## Features

- Username/password login (Flask-Login, hashed passwords)
- Add items with name, SKU (unique), quantity, location, and low-stock threshold
- One-click quantity adjustments (+ / −, never drops below 0)
- Search by name, SKU, or location
- Low-stock rows highlighted with a badge and running count
- SQLite storage, created automatically on first run

## Requirements

- Python 3.9+

## Run it locally (port 5047)

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

Then open <http://127.0.0.1:5047> in your browser.

The SQLite database (`inventory.db`) and a default user are created
automatically on first launch.

### Default login

| Username | Password |
|----------|----------|
| `admin`  | `admin`  |

> Change this before using the app anywhere real. You can also set a strong
> session key with the `SECRET_KEY` environment variable.

## Project layout

```
app.py             # application, routes, and SQLite setup
requirements.txt   # Python dependencies
templates/         # Jinja2 templates (base, login, index, add)
inventory.db       # created on first run (not in version control)
```
