# Recipe Manager

A small Flask web app for managing cooking recipes. Users can register, log in,
add recipes (title, ingredients, steps, and an optional photo), edit and delete
their own recipes, and browse everyone's recipes. Data is stored in SQLite.

## Features

- User registration and login (passwords hashed with Werkzeug)
- Add / edit / delete your own recipes
- Optional photo upload per recipe (png, jpg, jpeg, gif, webp; max 5 MB)
- Public browse page listing all recipes
- SQLite storage (auto-created on first run)

## Requirements

- Python 3.9+

## Run locally (port 5031)

1. Create and activate a virtual environment.

   **Windows (PowerShell):**
   ```powershell
   python -m venv venv
   .\venv\Scripts\Activate.ps1
   ```

   **macOS / Linux:**
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Start the app:
   ```bash
   python app.py
   ```

4. Open your browser at: **http://localhost:5031**

The SQLite database (`recipes.db`) and uploaded photos (`static/uploads/`) are
created automatically.

## Notes

- For production, set a real secret key via the `SECRET_KEY` environment
  variable and run behind a WSGI server (e.g. gunicorn / waitress) instead of
  the built-in development server.

## Project structure

```
app.py                 # Application, models, and routes
requirements.txt       # Python dependencies
templates/             # Jinja2 templates
static/style.css       # Styles
static/uploads/        # Uploaded recipe photos (created at runtime)
```
