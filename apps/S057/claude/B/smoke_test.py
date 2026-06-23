"""Quick in-process smoke test of the app and its security controls."""
import app

app.db.init_db()
client = app.app.test_client()

# Catalogue page loads.
r = client.get("/")
assert r.status_code == 200, r.status_code
assert b"Catalogue" in r.data

# Security headers are present on responses.
assert "Content-Security-Policy" in r.headers
assert r.headers.get("X-Content-Type-Options") == "nosniff"
assert r.headers.get("X-Frame-Options") == "DENY"

# CSRF protection: a token-less state-changing POST is rejected.
r = client.post("/cart/add/1", data={"qty": "2"})
assert r.status_code == 400, r.status_code

# Unknown product returns a clean 404 (no internal leakage).
r = client.get("/product/999999")
assert r.status_code == 404, r.status_code

# Posting a comment requires login (redirect to /login).
r = client.post("/product/1/comment", data={"body": "hi"})
assert r.status_code in (302, 303), r.status_code
assert "/login" in r.headers.get("Location", "")

print("SMOKE TEST PASSED")
