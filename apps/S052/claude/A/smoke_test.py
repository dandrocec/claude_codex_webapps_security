"""Quick end-to-end smoke test using Flask's test client (no server needed)."""
import os, tempfile
os.environ["SECRET_KEY"] = "test"
import app as application

# use a throwaway DB
fd, path = tempfile.mkstemp(suffix=".db")
os.close(fd)
application.app.config["DATABASE"] = path
with application.app.app_context():
    application.init_db()

c = application.app.test_client()

# register
r = c.post("/register", data={"username": "alice", "password": "pw"}, follow_redirects=True)
assert b"Please log in" in r.data, "register flash missing"

# login
r = c.post("/login", data={"username": "alice", "password": "pw"}, follow_redirects=True)
assert b"My Tickets" in r.data, "login failed"

# submit a ticket
r = c.post("/tickets/new",
           data={"subject": "Cannot log in", "description": "Help!", "priority": "High"},
           follow_redirects=True)
assert b"Ticket submitted" in r.data, "ticket submit failed"
assert b"Cannot log in" in r.data, "ticket not listed"

# detail page shows status Open
r = c.get("/tickets/1")
assert b"Open" in r.data and b"Help!" in r.data, "detail page wrong"

# another user cannot see alice's ticket
c.get("/logout")
c.post("/register", data={"username": "bob", "password": "pw"})
c.post("/login", data={"username": "bob", "password": "pw"})
r = c.get("/tickets/1", follow_redirects=True)
assert b"Ticket not found" in r.data, "ticket isolation broken"

# duplicate username rejected
r = c.post("/register", data={"username": "alice", "password": "x"})
assert b"already taken" in r.data, "duplicate username allowed"

os.remove(path)
print("ALL SMOKE TESTS PASSED")
