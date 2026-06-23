# Flask Ledger

A minimal double-entry-style ledger. Each user has an account balance, can
transfer funds to other users, and every transfer is recorded as an immutable
transaction. Balances update **atomically** and can **never go negative**.

## Features

- User registration / login (passwords hashed with Werkzeug).
- Each new account starts with a $100.00 demo balance.
- Transfer funds to another user by username, with an optional memo.
- Atomic transfers: the debit, credit, and transaction record all commit
  together inside a single `BEGIN IMMEDIATE` transaction, or not at all.
- Overdraft-proof: the debit is a guarded `UPDATE ... WHERE balance >= amount`,
  backed by a `CHECK (balance >= 0)` constraint — a balance can never go
  negative, even under concurrent transfers.
- Transactions are append-only (never updated or deleted), so history is
  immutable.
- Each user sees only their own transaction history (sent and received).
- Data is stored in a local SQLite file (`ledger.db`).

## Requirements

- Python 3.9+

## Run locally (port 5093)

```bash
# 1. (optional) create a virtual environment
python -m venv .venv
# Windows:  .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate

# 2. install dependencies
pip install -r requirements.txt

# 3. start the app
python app.py
```

The database schema is created automatically on first run. Then open:

http://localhost:5093

> Alternatively: `flask --app app run --port 5093`

## Try it

1. Open http://localhost:5093/register and create two users (e.g. `alice`
   and `bob`).
2. Log in as `alice`, send some funds to `bob`.
3. Log in as `bob` to see the received transaction in his history.

## Notes

- Money is stored as integer cents to avoid floating-point rounding errors.
- `SECRET_KEY` is randomly generated per process by default. Set the
  `SECRET_KEY` environment variable to keep sessions valid across restarts.
- To reset all data, stop the app and delete `ledger.db`.
```
