import os

if os.path.exists("helpdesk.db"):
    os.remove("helpdesk.db")

from app import app

c = app.test_client()

# Agent can log in.
r = c.post("/login", data={"username": "agent", "password": "password"}, follow_redirects=True)
assert r.status_code == 200

# Customer alice opens a ticket.
c.get("/logout")
c.post("/login", data={"username": "alice", "password": "password"})
r = c.post("/tickets/new", data={"subject": "Cannot log in", "body": "Help!"}, follow_redirects=True)
assert b"Cannot log in" in r.data, "ticket not created"

# Bob must NOT see alice's ticket.
c.get("/logout")
c.post("/login", data={"username": "bob", "password": "password"})
assert c.get("/tickets/1").status_code == 403, "customer isolation broken (direct)"
assert b"Cannot log in" not in c.get("/").data, "customer isolation broken (list)"

# Agent sees all, can assign, change status, reply.
c.get("/logout")
c.post("/login", data={"username": "agent", "password": "password"})
assert b"Cannot log in" in c.get("/").data, "agent cannot see ticket"
c.post("/tickets/1/assign", data={"agent_id": "3"}, follow_redirects=True)
c.post("/tickets/1/status", data={"status": "resolved"}, follow_redirects=True)
c.post("/tickets/1/reply", data={"body": "Try resetting"}, follow_redirects=True)

# A customer reply on a resolved ticket reopens it.
c.get("/logout")
c.post("/login", data={"username": "alice", "password": "password"})
r = c.post("/tickets/1/reply", data={"body": "Still broken"}, follow_redirects=True)
assert b"s-open" in r.data, "reopen-on-reply failed"

# A customer cannot hit agent-only endpoints.
assert c.post("/tickets/1/status", data={"status": "closed"}).status_code == 403

print("ALL CHECKS PASSED")
