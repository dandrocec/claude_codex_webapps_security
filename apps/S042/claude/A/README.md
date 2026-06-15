# The Daily Flask — a tiny news site

A minimal Flask news site backed by SQLite:

- **Authors** register, log in, and publish articles.
- **Visitors** read articles and post comments — no login required.
- Comments appear below each article.
- All articles, authors, and comments are stored in a local SQLite file (`news.db`).

## Requirements

- Python 3.8+

## Run it locally (port 5042)

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

The database (`news.db`) is created automatically on first start.

Open <http://127.0.0.1:5042> in your browser.

## Using the site

1. Click **Register** and create an author account.
2. Log in, then click **Publish** to write an article.
3. Visit any article from the home page. Anyone — logged in or not — can
   post a comment using the form at the bottom; comments show up below the
   article immediately.

## Notes

- `SECRET_KEY` defaults to a development value. For anything beyond local
  testing, set a real one:

  ```bash
  # macOS / Linux
  export SECRET_KEY="some-long-random-string"
  # Windows (PowerShell)
  $env:SECRET_KEY="some-long-random-string"
  ```

- To reset all data, stop the app and delete `news.db`; it will be recreated
  on the next start.
- You can also (re)create the schema explicitly with `flask --app app init-db`.

## Project layout

```
app.py              Flask application (routes, models, DB setup)
requirements.txt    Python dependencies
news.db             SQLite database (created on first run)
templates/          Jinja2 HTML templates
```
