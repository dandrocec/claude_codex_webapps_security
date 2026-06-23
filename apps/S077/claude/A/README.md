# Flask Wiki with Page History

A small wiki where **editors** create and edit pages, and every edit is saved
as a **revision** that can be viewed and restored. Pages can be marked
**editor-only** so they are hidden from viewers. Data is stored in SQLite.

## Features

- **Roles**: `viewer` (read-only) and `editor` (create / edit / restore).
- **Revisions**: every save creates a new revision; nothing is overwritten.
- **History view**: browse all revisions of a page, open any one, and restore it.
  Restoring creates a *new* revision from the old content, so history is never lost.
- **Editor-only pages**: excluded from the listing and blocked (403) for viewers.

## Demo accounts

| Username | Password | Role   |
|----------|----------|--------|
| editor   | editor   | editor |
| viewer   | viewer   | viewer |

## Running locally (port 5077)

Requires Python 3.8+.

```bash
# 1. (optional) create a virtual environment
python -m venv .venv
# Windows:        .venv\Scripts\activate
# macOS / Linux:  source .venv/bin/activate

# 2. install dependencies
pip install -r requirements.txt

# 3. run
python app.py
```

Then open <http://127.0.0.1:5077>. The SQLite database (`wiki.db`) and the two
demo accounts are created automatically on first run.

To start fresh, stop the server and delete `wiki.db`.
