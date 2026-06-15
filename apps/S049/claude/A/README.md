# Newsletter Manager

A small Flask application for a single newsletter editor. After logging in you can:

- **Manage subscribers** — add subscribers (email + optional name) and remove them.
- **Compose drafts** — write newsletter drafts with a subject and body, edit and save them.
- **Preview** — see exactly how a draft would look when delivered to your subscribers.

Subscribers and drafts are stored in a local **SQLite** database (`newsletter.db`),
created automatically on first run.

## Requirements

- Python 3.9+

## Run it locally (port 5049)

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

Then open <http://127.0.0.1:5049> in your browser.

### Default login

| Username | Password   |
| -------- | ---------- |
| `editor` | `changeme` |

## Configuration

All optional — set as environment variables before starting the app:

| Variable          | Default            | Purpose                                  |
| ----------------- | ------------------ | ---------------------------------------- |
| `EDITOR_USERNAME` | `editor`           | Login username for the editor.           |
| `EDITOR_PASSWORD` | `changeme`         | Login password for the editor.           |
| `SECRET_KEY`      | `dev-secret-...`   | Flask session signing key (set in prod). |

Example (macOS / Linux):

```bash
EDITOR_PASSWORD="my-strong-password" SECRET_KEY="$(python -c 'import secrets;print(secrets.token_hex())')" python app.py
```

## Project layout

```
app.py              # Flask app: routes, auth, SQLite access
requirements.txt    # Python dependencies
newsletter.db       # SQLite database (auto-created on first run)
templates/          # Jinja2 templates
static/style.css    # Styling
```

## Notes

- The database schema is created automatically on startup, so there is no
  separate migration step.
- Draft bodies are treated as plain text; newlines are preserved in the preview
  and all content is HTML-escaped, so subscriber/draft input is safe to render.
```
