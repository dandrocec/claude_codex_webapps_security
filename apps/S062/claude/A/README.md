# Flask Helpdesk

A small support desk where **customers** open tickets and reply to them, and
**agents** triage every ticket — assigning them, changing status, and replying.
Customers only ever see their own tickets. Data is stored in a local SQLite file.

## Features

- Customer / agent roles with session-based login (passwords hashed).
- Customers register, open tickets, and add replies; they see only their own tickets.
- Agents see **all** tickets, assign them to an agent, change status
  (`open` → `pending` → `resolved` → `closed`), and reply.
- A customer reply on a resolved/closed ticket automatically reopens it.
- SQLite database created and seeded automatically on first run.

## Requirements

- Python 3.9+

## Run it locally (port 5062)

```bash
# 1. (optional) create a virtual environment
python -m venv venv
# Windows:        venv\Scripts\activate
# macOS / Linux:  source venv/bin/activate

# 2. install dependencies
pip install -r requirements.txt

# 3. start the app
python app.py
```

Then open <http://127.0.0.1:5062>.

The first launch creates `helpdesk.db` and seeds three demo accounts
(all with password `password`):

| Username | Role     |
|----------|----------|
| `alice`  | customer |
| `bob`    | customer |
| `agent`  | agent    |

Register a new account from the login page to create additional customers.

## Reset the data

Stop the server and delete `helpdesk.db`; it will be recreated and reseeded on
the next start.

## Project layout

```
app.py              # all routes, auth, and DB access
requirements.txt    # Python dependencies
templates/          # Jinja2 templates (base, login, register, ticket views)
helpdesk.db         # SQLite database (created at runtime)
```
