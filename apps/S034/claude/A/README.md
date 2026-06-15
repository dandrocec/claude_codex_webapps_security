# Reading List

A small Flask app for tracking books. Each user logs in and manages their own
list: add a book (title, author), set its **status** (`to-read` / `reading` /
`finished`), and give it a **rating** (1–5). Lists are private per user and data
is stored in a local SQLite database.

## Features

- User registration and login (passwords hashed with Werkzeug)
- Add / update / delete books — scoped to the logged-in user
- Track status and rating; filter the list by status
- SQLite storage (`reading_list.db`, created automatically on first run)

## Requirements

- Python 3.9+

## Run locally (port 5034)

```bash
# 1. Create and activate a virtual environment
python -m venv venv
# Windows (PowerShell):
venv\Scripts\Activate.ps1
# macOS / Linux:
source venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Start the app
python app.py
```

Then open <http://127.0.0.1:5034> in your browser, register an account, and start
adding books.

> The SQLite database file `reading_list.db` is created in the project folder the
> first time you run the app. Delete it to reset all data.

## Optional configuration

- `SECRET_KEY` — set this environment variable in production to a random value
  (a development default is used otherwise).

  ```bash
  # macOS / Linux
  export SECRET_KEY="$(python -c 'import secrets; print(secrets.token_hex(32))')"
  # Windows (PowerShell)
  $env:SECRET_KEY = python -c "import secrets; print(secrets.token_hex(32))"
  ```

## Project layout

```
app.py             # application, models, and routes
requirements.txt   # Python dependencies
templates/         # Jinja2 templates (base, login, register, books)
reading_list.db    # SQLite database (auto-created, not committed)
```
