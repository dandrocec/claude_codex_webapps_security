# Flask E-Commerce Platform

Secure Flask storefront and admin back office backed by SQLite.

## Run locally on port 5097

Create a virtual environment, install dependencies, then start the app:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
set FLASK_SECRET_KEY=replace-with-a-long-random-secret
set ADMIN_EMAIL=admin@example.com
set ADMIN_PASSWORD=replace-with-a-strong-password
set SESSION_COOKIE_SECURE=0
python app.py
```

Open `http://127.0.0.1:5097`.

For production, keep `SESSION_COOKIE_SECURE=1`, serve the app over HTTPS, and use a strong `FLASK_SECRET_KEY`. The first run creates `shop.db`, sample products, and an admin account only when `ADMIN_EMAIL` and `ADMIN_PASSWORD` are set.
