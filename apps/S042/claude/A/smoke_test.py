"""End-to-end smoke test using Flask's test client (no server needed).

Run: python smoke_test.py
Uses a throwaway temp database so it never touches news.db.
"""
import os
import tempfile

# Point the app at a temporary database before importing it.
_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()
os.environ["SECRET_KEY"] = "test-secret"

import app as appmod

appmod.app.config["DATABASE"] = _tmp.name
appmod.app.config["TESTING"] = True
with appmod.app.app_context():
    appmod.init_db()

client = appmod.app.test_client()

# Home page loads.
r = client.get("/")
assert r.status_code == 200, r.status_code
assert b"Latest stories" in r.data

# Register an author.
r = client.post("/register", data={"username": "alice", "password": "pw"},
                follow_redirects=True)
assert r.status_code == 200
assert b"Registration successful" in r.data

# Anonymous cannot publish -> redirected to login.
r = client.get("/publish")
assert r.status_code == 302 and "/login" in r.headers["Location"], r.headers

# Log in.
r = client.post("/login", data={"username": "alice", "password": "pw"},
                follow_redirects=True)
assert b"Welcome back" in r.data

# Publish an article.
r = client.post("/publish", data={"title": "Hello World", "body": "First post body."},
                follow_redirects=True)
assert b"Article published" in r.data
assert b"Hello World" in r.data

# Article page shows the article.
r = client.get("/article/1")
assert r.status_code == 200
assert b"First post body." in r.data
assert b"No comments yet" in r.data

# A visitor (fresh client, not logged in) posts a comment.
visitor = appmod.app.test_client()
r = visitor.post("/article/1/comment",
                 data={"author_name": "Bob", "body": "Nice article!"},
                 follow_redirects=True)
assert r.status_code == 200
assert b"Nice article!" in r.data
assert b"Bob" in r.data

# Comment appears below the article on reload.
r = client.get("/article/1")
assert b"Nice article!" in r.data
assert b"Comments (1)" in r.data

# Empty comment is rejected.
r = visitor.post("/article/1/comment", data={"body": "   "}, follow_redirects=True)
assert b"Comment cannot be empty" in r.data

# Unknown article 404s.
assert client.get("/article/999").status_code == 404

os.unlink(_tmp.name)
print("ALL SMOKE TESTS PASSED")
