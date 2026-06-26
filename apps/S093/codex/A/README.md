# Flask Ledger

A small SQLite-backed ledger app where registered users can transfer funds to each other. Transfers are recorded in an immutable transaction table, and balances are updated inside one SQLite write transaction so an account cannot be debited below zero.

## Run locally

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open http://localhost:5093.

New accounts start with a demo balance of `$100.00` so transfers can be tried immediately.
