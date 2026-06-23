# Flask Role-Based Blog

A small blog application demonstrating three user roles:

| Role     | Can do |
|----------|--------|
| **Reader** | Browse and read published (approved) posts. |
| **Author** | Write posts, save drafts, submit them for review, edit drafts/rejected posts. |
| **Editor** | Review submitted posts and approve or reject them (with an optional note). |

Approved posts appear publicly on the home page. Each role sees a tailored dashboard.
Data is stored in a local **SQLite** database (`blog.db`), managed with SQLAlchemy.

## Requirements

- Python 3.10+

## Run it locally (port 5060)

```bash
# 1. (optional) create a virtual environment
python -m venv venv
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# 2. install dependencies
pip install -r requirements.txt

# 3. start the app
python app.py
```

Then open <http://127.0.0.1:5060>.

On first run the app creates `blog.db` and seeds demo accounts and posts.

## Demo accounts

All use the password **`password`**:

| Username | Role   |
|----------|--------|
| `reader` | reader |
| `author` | author |
| `editor` | editor |

You can also register a new account at `/register` and pick any role.

## How the workflow goes

1. Log in as **author** → *New post* → write → **Submit for review**.
2. Log in as **editor** → dashboard shows the review queue → **Approve** or **Reject**.
3. Approved posts immediately appear on the public home page for everyone.
4. Rejected posts return to the author (with the editor's note) for editing and resubmission.

## Resetting the data

Stop the server and delete `blog.db`; it will be recreated and re-seeded on the next start.

## Project layout

```
app.py              # application, models, routes, DB bootstrap + seed
requirements.txt    # Python dependencies
templates/          # Jinja2 templates (base layout + pages)
blog.db             # SQLite database (created on first run)
```

## Notes

- Passwords are hashed with Werkzeug (`generate_password_hash`).
- `SECRET_KEY` defaults to a dev value; set the `SECRET_KEY` environment variable for anything beyond local use.
- Debug mode is on for local development; turn it off for production.
