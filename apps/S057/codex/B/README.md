# Secure Shop

A small Flask and SQLite online shop with a product catalogue, product comments, user accounts, and a session-backed shopping cart.

## Run locally on port 5057

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SECRET_KEY = "replace-with-a-long-random-secret"
$env:PORT = "5057"
python app.py
```

Open `https://127.0.0.1:5057`. The app uses an ad-hoc local TLS certificate so secure session cookies work during local development; your browser may ask you to accept the certificate.

The SQLite database is created automatically as `shop.db` on first startup and seeded with sample products.

## Security notes

The app uses parameterised SQLite queries, bcrypt password hashing, CSRF tokens on state-changing forms, ownership checks for comment deletion, secure cookie flags, security headers, generic error pages, and environment-based secrets.
