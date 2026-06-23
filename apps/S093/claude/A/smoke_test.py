import os
import sqlite3
import tempfile

import app as a

a.DATABASE = os.path.join(tempfile.gettempdir(), "ledger_test.db")
if os.path.exists(a.DATABASE):
    os.remove(a.DATABASE)
a.init_db()

c = a.app.test_client()
for u in ("alice", "bob"):
    c.post("/register", data={"username": u, "password": "pw"})
c.post("/login", data={"username": "alice", "password": "pw"},
       follow_redirects=True)

# Overdraft attempt must be blocked.
r = c.post("/transfer", data={"recipient": "bob", "amount": "999999"},
           follow_redirects=True)
assert b"Insufficient funds" in r.data, "overdraft not blocked!"

# Self-transfer must be blocked.
r = c.post("/transfer", data={"recipient": "alice", "amount": "5"},
           follow_redirects=True)
assert b"cannot transfer funds to yourself" in r.data, "self-transfer allowed!"

# Valid transfer.
c.post("/transfer", data={"recipient": "bob", "amount": "30", "memo": "lunch"},
       follow_redirects=True)

db = sqlite3.connect(a.DATABASE)
bal = {row[0]: row[1] for row in db.execute("SELECT username, balance FROM users")}
assert bal["alice"] == 7000 and bal["bob"] == 13000, bal
ntx = db.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
assert ntx == 1, ntx

# bob sees the transaction in his own history.
c.get("/logout")
c.post("/login", data={"username": "bob", "password": "pw"}, follow_redirects=True)
hist = c.get("/").data
assert b"lunch" in hist and b"Received" in hist, "history missing for recipient"

print("PASS: overdraft blocked, self-transfer blocked, balances", bal,
      "tx count", ntx, "- recipient history OK")
