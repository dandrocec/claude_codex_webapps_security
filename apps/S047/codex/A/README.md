# Flask Inventory Tracker

A small Flask app for tracking inventory in SQLite. Users can register, sign in, add items with name, SKU, quantity, and location, search inventory, adjust quantities, and quickly spot low-stock items.

## Run locally on port 5047

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:5047` in your browser.

The SQLite database is created automatically as `inventory.sqlite3` when the app starts.
