# 🗳 VotePlatform — Flask Voting Platform

A small voting application built with Flask and SQLite.

- **Admins** create elections with a title, candidates, and an open/close window.
- **Registered users** cast **exactly one vote per election** while it is open.
- **Results** are hidden until an election has **closed**, then shown to everyone.

## Requirements

- Python 3.9+

## Run it locally (port 5081)

```bash
# 1. (Recommended) create and activate a virtual environment
python -m venv venv
# Windows (PowerShell):
venv\Scripts\Activate.ps1
# macOS / Linux:
source venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Start the app
python app.py
```

Then open **http://127.0.0.1:5081** in your browser.

On first launch the app creates `voting.db` and seeds a bootstrap **admin** account.

## Default admin login

| Username | Password   |
| -------- | ---------- |
| `admin`  | `admin123` |

You can override these before the first run via environment variables:

```bash
# PowerShell
$env:ADMIN_USERNAME="myadmin"; $env:ADMIN_PASSWORD="s3cret"; python app.py
# bash
ADMIN_USERNAME=myadmin ADMIN_PASSWORD=s3cret python app.py
```

(Set `SECRET_KEY` similarly to use a fixed session-signing key.)

## How to use

1. **Log in as admin** → click **New election**. Enter a title, one candidate per
   line, and the open/close times, then create it.
2. **Register** a regular user account (or several) via **Register**.
3. While an election is **open**, a logged-in user picks one candidate and submits.
   A second attempt is rejected — one vote per user per election is enforced at the
   database level.
4. Once the **close time** passes, the election page shows the tallied results.

## Notes

- Times entered in the form use your browser's local timezone; they are stored
  internally as UTC.
- Data lives in a single SQLite file (`voting.db`) next to `app.py`. Delete that
  file to reset the application to a clean state.
- `debug=True` is enabled for convenience during local development; disable it for
  any real deployment.

## Project layout

```
app.py                 # application, routes, and SQLite schema
requirements.txt       # Python dependencies
templates/             # Jinja2 templates
  base.html
  index.html
  election_detail.html
  login.html
  register.html
  new_election.html
voting.db              # created automatically on first run
```
