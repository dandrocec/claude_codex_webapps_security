# Flask Invoicing App

A small SQLite-backed invoicing app for managing clients, creating invoices with line items, calculating tax and totals, and rendering printable invoices.

## Run locally on port 5079

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
set FLASK_APP=app.py
flask --app app run --host 127.0.0.1 --port 5079
```

On macOS/Linux, activate the environment with:

```bash
source .venv/bin/activate
```

Then open `http://127.0.0.1:5079`.

The SQLite database is created automatically at `instance/invoices.sqlite` the first time the app starts.
