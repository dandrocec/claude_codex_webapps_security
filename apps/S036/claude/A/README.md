# Flask Wiki

A minimal wiki built with Flask and SQLite.

- **Anyone** can read pages, browse the page index, and search by title.
- **Logged-in users** can create and edit pages written in Markdown.
- Pages are stored in a local SQLite database (`wiki.db`, created automatically).
- Markdown is rendered server-side and sanitized with `bleach`.

## Requirements

- Python 3.9+

## Run locally (port 5036)

```bash
# 1. (optional) create a virtual environment
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# 2. install dependencies
pip install -r requirements.txt

# 3. start the app
python app.py
```

Then open **http://localhost:5036**.

The SQLite database is created automatically on first run.

## Usage

1. Click **Register** to create an account, then you'll be logged in.
2. Use **+ New page** to create a page — enter a title, then write the body in Markdown.
3. Visit any page and click **Edit** to change it.
4. Browse all pages from the home page, or use the **Search** box to find pages by title.

## Notes

- Set a real secret key in production via the `SECRET_KEY` environment variable:
  ```bash
  export SECRET_KEY="some-long-random-value"   # Windows: set SECRET_KEY=...
  ```
- `debug=True` is enabled for convenience during local development; disable it for production.

## Project layout

```
app.py              # application, routes, DB + Markdown handling
requirements.txt    # dependencies
templates/          # Jinja2 templates
static/style.css    # styling
wiki.db             # SQLite database (created on first run)
```
