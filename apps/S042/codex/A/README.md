# Daily Ledger

A small Flask news site where registered authors can publish articles and visitors can comment on each article. Articles and comments are stored in SQLite.

## Run locally on port 5042

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:5042` in your browser.

The SQLite database is created automatically in Flask's `instance` folder the first time the app handles a request. You can also initialize it explicitly with:

```bash
flask --app app init-db
```
