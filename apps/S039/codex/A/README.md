# Flask Event Listing App

A small Flask app where organisers can register, sign in, create events, and manage only their own listings. The public homepage shows upcoming events sorted by date.

## Run locally

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5039 in your browser.

The app stores data in `events.sqlite3`. The database tables are created automatically on startup. You can also initialize them manually with:

```bash
flask --app app init-db
```
