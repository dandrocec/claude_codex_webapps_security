"""Quick end-to-end smoke test using Flask's test client (no server needed)."""
import os, tempfile
os.environ["EDITOR_PASSWORD"] = "changeme"
os.environ["SECRET_KEY"] = "test"

import app as application

# Use a throwaway DB file so we don't touch the real one.
fd, path = tempfile.mkstemp(suffix=".db")
os.close(fd)
application.app.config["DATABASE"] = path
with application.app.app_context():
    application.init_db()

c = application.app.test_client()

# Unauthenticated -> redirected to login
r = c.get("/")
assert r.status_code == 302 and "/login" in r.headers["Location"], r.status_code

# Bad login
r = c.post("/login", data={"username": "editor", "password": "wrong"})
assert b"Invalid username" in r.data

# Good login
r = c.post("/login", data={"username": "editor", "password": "changeme"},
           follow_redirects=True)
assert b"Dashboard" in r.data

# Add subscriber
r = c.post("/subscribers/add", data={"email": "a@example.com", "name": "Ann"},
           follow_redirects=True)
assert b"a@example.com" in r.data
# Duplicate rejected
r = c.post("/subscribers/add", data={"email": "a@example.com", "name": ""},
           follow_redirects=True)
assert b"already subscribed" in r.data
# Invalid email rejected
r = c.post("/subscribers/add", data={"email": "nope", "name": ""},
           follow_redirects=True)
assert b"valid email" in r.data

# Create draft
r = c.post("/drafts/new", data={"subject": "Hello", "body": "Line 1\nLine 2"},
           follow_redirects=True)
assert b"Hello" in r.data

# Edit draft id 1
r = c.post("/drafts/1/edit", data={"subject": "Updated", "body": "<b>x</b>\nNext"},
           follow_redirects=True)
assert b"Updated" in r.data

# Preview renders, escapes HTML, and converts newlines
r = c.get("/drafts/1/preview")
assert b"Updated" in r.data
assert b"&lt;b&gt;x&lt;/b&gt;" in r.data, "body should be HTML-escaped"
assert b"<br>" in r.data, "newlines should become <br>"

# Missing draft -> 404
assert c.get("/drafts/999/preview").status_code == 404

# Delete draft and subscriber
assert c.post("/drafts/1/delete", follow_redirects=True).status_code == 200
assert c.post("/subscribers/1/delete", follow_redirects=True).status_code == 200

# Logout
r = c.get("/logout", follow_redirects=True)
assert b"Editor login" in r.data

os.remove(path)
print("ALL SMOKE TESTS PASSED")
