import os
if os.path.exists("blog.db"):
    os.remove("blog.db")
import app as m
m.init_db(seed=True)
c = m.app.test_client()

r = c.get("/")
assert r.status_code == 200 and b"Welcome to the blog" in r.data, "home"

r = c.post("/login", data={"username": "editor", "password": "password"},
           follow_redirects=True)
assert b"Editor dashboard" in r.data and b"Please review me" in r.data, "editor dash"

r = c.post("/posts/3/review", data={"decision": "approve", "note": "ok"},
           follow_redirects=True)
assert r.status_code == 200, "approve"
r = c.get("/")
assert b"Please review me" in r.data, "approved now public"
c.get("/logout")

c.post("/login", data={"username": "author", "password": "password"})
r = c.post("/posts/new",
           data={"title": "My new post", "body": "hello world", "action": "submit"},
           follow_redirects=True)
assert b"submitted for review" in r.data.lower(), "author submit"

c.get("/logout")
c.post("/login", data={"username": "reader", "password": "password"})
r = c.get("/posts/new")
assert r.status_code == 403, "reader forbidden"
r = c.get("/dashboard")
assert b"Reader dashboard" in r.data, "reader dash"

print("ALL SMOKE TESTS PASSED")
