# Flask Invoicing App

A small multi-user invoicing app with clients, invoices, line items, tax calculation, and printable invoice pages. Data is stored in SQLite.

## Run locally on port 5079

Set a secret key before starting the app:

```bash
set FLASK_SECRET_KEY=change-this-to-a-long-random-secret
set DATABASE_PATH=invoice_app.sqlite3
set SESSION_COOKIE_SECURE=false
python -m flask --app app run --host 127.0.0.1 --port 5079
```

On macOS/Linux, use `export` instead of `set`.

`SESSION_COOKIE_SECURE` defaults to `true` for safer production behavior. Set it to `false` only for local HTTP development.

