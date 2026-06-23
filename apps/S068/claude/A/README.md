# Scheduler

A small Flask scheduling app backed by SQLite.

- **Providers** publish available time slots.
- **Clients** browse free slots, book one, and get a confirmation.
- A slot can **never be booked twice** — booking is an atomic, conditional update.
- Each role sees only their own appointments.

## Requirements

- Python 3.9+

## Run it locally (port 5068)

```bash
# 1. (optional) create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS / Linux:
source .venv/bin/activate

# 2. install dependencies
pip install -r requirements.txt

# 3. start the app
python app.py
```

Then open **http://localhost:5068**.

The SQLite database (`scheduling.db`) is created automatically on first run.

## Try it out

1. Register a **provider** account and publish a couple of slots.
2. Log out, register a **client** account, open **Browse slots**, and book one.
3. You'll land on a confirmation page; the slot then appears under **My appointments**.
4. Back in the provider account, the slot now shows as **Booked** with the client's name.
5. If two clients try to book the same slot, only the first succeeds — the second
   sees "that slot has just been taken."

## How double-booking is prevented

Booking runs a single conditional statement:

```sql
UPDATE slots SET client_id = ? WHERE id = ? AND client_id IS NULL
```

The row is only claimed if it is still free. If two requests race, exactly one
update affects a row; the other gets `rowcount == 0` and is told the slot was taken.

## Project layout

```
app.py              # application, routes, and database logic
requirements.txt    # Python dependencies
templates/          # Jinja2 HTML templates
scheduling.db       # SQLite database (created at runtime)
```
