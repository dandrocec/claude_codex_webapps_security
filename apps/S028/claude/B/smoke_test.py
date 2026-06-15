"""Quick end-to-end smoke test using Flask's test client (no network needed)."""
import os
import tempfile

os.environ["SECRET_KEY"] = "test-secret-key-not-for-production"
os.environ["SESSION_COOKIE_SECURE"] = "false"
os.environ["DATABASE_PATH"] = os.path.join(tempfile.gettempdir(), "smoke_notes.db")
# fresh db
if os.path.exists(os.environ["DATABASE_PATH"]):
    os.remove(os.environ["DATABASE_PATH"])

import re
from app import app

app.config["WTF_CSRF_ENABLED"] = False  # client can't read tokens; logic tested separately
client = app.test_client()


def post(path, **data):
    return client.post(path, data=data, follow_redirects=True)


# register + login
assert post("/register", username="alice", password="hunter2hunter").status_code == 200
assert post("/login", username="alice", password="hunter2hunter").status_code == 200

# create a note, with an XSS attempt in the body
r = post("/notes/new", title="First", body="<script>alert(1)</script>")
assert r.status_code == 200
assert b"&lt;script&gt;" in r.data, "body must be HTML-escaped (XSS prevention)"
assert b"<script>alert(1)</script>" not in r.data

# list shows the note
r = client.get("/notes")
assert b"First" in r.data

# second user cannot see or edit alice's note (IDOR check)
client.get("/logout")  # GET won't logout (POST only), so clear cookies instead
client2 = app.test_client()
client2.post("/register", data={"username": "bob", "password": "passwordbob"})
client2.post("/login", data={"username": "bob", "password": "passwordbob"})
# find alice's note id (it's 1)
assert client2.get("/notes/1/edit").status_code == 404, "IDOR: bob must not access alice's note"
assert client2.post("/notes/1/delete", follow_redirects=True).status_code == 404 \
    or client2.post("/notes/1/delete").status_code == 404

# wrong password rejected
bad = app.test_client().post("/login", data={"username": "alice", "password": "wrong"},
                             follow_redirects=True)
assert b"Invalid username or password" in bad.data

# security headers present
r = client.get("/notes")
assert "Content-Security-Policy" in r.headers
assert r.headers.get("X-Frame-Options") == "DENY"
assert r.headers.get("X-Content-Type-Options") == "nosniff"

print("ALL SMOKE TESTS PASSED")
