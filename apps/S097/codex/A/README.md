# Flask E-commerce Platform

A small SQLite-backed Flask shop with a customer storefront and an admin back office.

## Run locally

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5097

The app creates `shop.db` automatically and seeds a default admin account:

- Email: `admin@example.com`
- Password: `admin123`

Customer accounts can be created from the register page. Admin tools are available at `/admin`.
