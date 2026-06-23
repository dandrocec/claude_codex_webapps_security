"""Quick end-to-end smoke test (run: python smoke_test.py).

Exercises register -> transfer -> overdraw-rejection -> history scoping
against an isolated temporary database. Not part of the app's runtime.
"""
import os
import sqlite3
import tempfile

os.environ.setdefault("SECRET_KEY", "test-only")
os.environ.setdefault("SECURE_COOKIES", "false")

import app
import db

fd, path = tempfile.mkstemp(suffix=".db")
os.close(fd)
db.DB_PATH = path
app.db.DB_PATH = path
db.init_db()

app.app.config.update(TESTING=True, WTF_CSRF_ENABLED=False)
c = app.app.test_client()

r = c.post("/register", data={"username": "alice", "password": "password123"})
assert r.status_code in (302, 200), r.status_code
c.post("/logout")

r = c.post("/register", data={"username": "bob", "password": "password123"})
assert r.status_code in (302, 200), r.status_code

# bob (logged in) sends $30 to alice
r = c.post("/transfer", data={"recipient": "alice", "amount": "30.00", "memo": "hi"},
           follow_redirects=True)
assert r.status_code == 200

# overdraw: bob has $70 left, try to send $100 -> must be rejected
r = c.post("/transfer", data={"recipient": "alice", "amount": "100.00"},
           follow_redirects=True)
assert b"Insufficient" in r.data, "overdraw was not blocked"

conn = sqlite3.connect(path)
conn.row_factory = sqlite3.Row
balances = {row["username"]: row["balance_cents"] for row in
            conn.execute("SELECT username, balance_cents FROM users")}
assert balances == {"alice": 13000, "bob": 7000}, balances
tx_count = conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
assert tx_count == 1, tx_count

# sub-cent precision rejected
r = c.post("/transfer", data={"recipient": "alice", "amount": "1.001"},
           follow_redirects=True)
assert b"fractions of a cent" in r.data, "sub-cent not rejected"

# self-transfer rejected
r = c.post("/transfer", data={"recipient": "bob", "amount": "1.00"},
           follow_redirects=True)
assert b"cannot transfer funds to yourself" in r.data

# history visible to bob and scoped
r = c.get("/history")
assert r.status_code == 200 and b"alice" in r.data

conn.close()
os.unlink(path)
print("SMOKE_OK: balances", balances, "tx", tx_count)
