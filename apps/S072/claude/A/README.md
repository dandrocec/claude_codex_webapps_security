# MemberHub — Flask Membership Site

A small Flask application with **free** and **premium** membership tiers.

## Features

- User registration and login (passwords hashed with Werkzeug).
- Two tiers: `free` and `premium`. Premium content is gated — free users are
  redirected to an upgrade page.
- **Tier-aware navigation**: the menu shows different links for free members,
  premium members, and admins.
- An **admin** role that can change any user's tier from an admin panel.
- Data stored in **SQLite** (`membership.db`, created automatically).

## Requirements

- Python 3.8+

## Run locally (port 5072)

```bash
# 1. (optional) create a virtual environment
python -m venv venv
# Windows:
venv\Scripts\activate
# macOS / Linux:
source venv/bin/activate

# 2. install dependencies
pip install -r requirements.txt

# 3. start the app
python app.py
```

Then open <http://127.0.0.1:5072> in your browser.

## Default admin account

On first run the database is seeded with an administrator:

| Username | Password   |
| -------- | ---------- |
| `admin`  | `admin123` |

Log in as `admin` to open the **Admin** panel and change any user's tier.
(Change this password before any real use.)

## Try it out

1. Register a new account — it starts on the **free** tier.
2. Visit **Premium Content** → you're redirected to the upgrade page.
3. Log in as `admin`, open **Admin**, and set your new user to **premium**.
4. Log back in as that user — **Premium Content** now appears in the nav and is
   accessible.

## Notes

- The app uses a development secret key by default. Set the `SECRET_KEY`
  environment variable for anything beyond local testing.
- `debug=True` is enabled for convenience; disable it in production.
