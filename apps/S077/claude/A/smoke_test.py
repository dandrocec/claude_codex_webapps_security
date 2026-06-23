"""Quick self-check: exercises the main flows with Flask's test client."""
import os
os.environ["SECRET_KEY"] = "test"
if os.path.exists("wiki.db"):
    os.remove("wiki.db")

import app as appmod
appmod.init_db()
client = appmod.app.test_client()

def login(u, p):
    return client.post("/login", data={"username": u, "password": p},
                       follow_redirects=True)

# anonymous can see empty index
assert client.get("/").status_code == 200

# viewer cannot create
login("viewer", "viewer")
assert client.get("/create").status_code == 403
client.post("/logout")

# editor creates a page
login("editor", "editor")
r = client.post("/create", data={"slug": "hello", "title": "Hello",
                "content": "v1 content"}, follow_redirects=True)
assert r.status_code == 200 and b"v1 content" in r.data

# edit creates a 2nd revision
client.post("/wiki/hello/edit", data={"title": "Hello", "content": "v2 content"})
r = client.get("/wiki/hello")
assert b"v2 content" in r.data and b"v1 content" not in r.data

# history shows 2 revisions
r = client.get("/wiki/hello/history")
assert r.data.count(b"Restore") == 1  # only the non-current one is restorable

# restore revision 1 -> creates revision 3 with v1 content
client.post("/wiki/hello/restore/1", follow_redirects=True)
r = client.get("/wiki/hello")
assert b"v1 content" in r.data
revs = client.get("/wiki/hello/history").data
assert revs.count(b"<tr>") == 4  # header + 3 revisions

# editor-only page hidden from viewer
client.post("/create", data={"slug": "secret", "title": "Secret",
            "content": "classified", "editor_only": "1"}, follow_redirects=True)
client.post("/logout")
login("viewer", "viewer")
assert client.get("/wiki/secret").status_code == 403
assert b"Secret" not in client.get("/").data
assert b"Hello" in client.get("/").data

print("ALL CHECKS PASSED")
