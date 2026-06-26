# Simple Online Shop

A small Flask shop with a product catalogue, database-backed product comments, and a session-backed cart with running totals.

## Run locally

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open http://localhost:5057 in your browser.

The app creates `shop.db` automatically on first run and seeds a few sample products.
