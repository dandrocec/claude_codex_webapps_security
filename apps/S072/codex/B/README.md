# Flask Membership Site

A small Flask membership app with free, premium, and admin tiers backed by SQLite.

## Run locally on port 5072

1. Create and activate a virtual environment.
2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Set required environment variables:

```bash
export SECRET_KEY="replace-with-a-long-random-secret"
export ADMIN_EMAIL="admin@example.com"
export ADMIN_PASSWORD="Use-A-Strong-Password-123!"
export ADMIN_USERNAME="Admin"
```

On Windows PowerShell, use `$env:SECRET_KEY="..."` instead of `export`.

4. Start the app:

```bash
python app.py
```

Open `https://127.0.0.1:5072`. The local development certificate is self-signed, so your browser may ask you to accept it.

## Features

- Registration and login with bcrypt password hashing.
- Free and premium content areas.
- Premium content is available only to premium members and admins.
- Admin users can change user tiers.
- Per-user notes use ownership checks to prevent cross-user access.
- CSRF protection, parameterised SQLite queries, secure cookies, and security headers are enabled.
