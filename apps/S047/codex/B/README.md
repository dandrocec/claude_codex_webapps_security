# Flask Inventory Tracker

A small Flask and SQLite inventory tracker with account registration, login, item search, quantity adjustments, and low-stock highlighting.

## Run locally on port 5047

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
set SECRET_KEY=replace-with-a-long-random-secret
set SESSION_COOKIE_SECURE=false
flask --app app run --host 127.0.0.1 --port 5047
```

Open `http://127.0.0.1:5047`.

`SESSION_COOKIE_SECURE=false` is only for local HTTP testing. Leave it unset or set it to `true` when running behind HTTPS. The SQLite database is created automatically as `inventory.sqlite3`; set `DATABASE_URL` to use a different SQLite file path.
