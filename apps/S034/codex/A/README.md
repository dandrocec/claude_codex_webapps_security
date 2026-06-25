# Flask Reading List

A small Flask app for tracking a personal reading list. Users can register, log in, add books, update reading status, add ratings, and keep their lists separate from other users.

## Run locally

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:5034` in your browser.

The app stores data in `reading_list.sqlite3`, which is created automatically on first run.
