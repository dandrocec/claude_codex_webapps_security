# Flask Wiki

A small SQLite-backed wiki with viewer and editor roles. Editors can create pages, edit pages, mark pages as editor-only, inspect revision history, view old revisions, and restore a prior revision.

## Run locally

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5077.

Use **Sign in** to choose either the viewer or editor role for local testing. The SQLite database is created automatically as `wiki.sqlite3` on first request.
