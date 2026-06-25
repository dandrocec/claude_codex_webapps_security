# Flask Wiki

A small Flask wiki backed by SQLite. Anyone can browse, read pages, and search by title. Logged-in users can create and edit pages with Markdown content.

## Run Locally

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5036 in your browser.

The app creates `wiki.db` automatically on first run. Set `SECRET_KEY` and `WIKI_DATABASE` environment variables to override the default development secret and database path.
