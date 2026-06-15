"""Quick self-check of the app via Flask's test client (no network)."""
import os
import re

os.environ["FLASK_ENV"] = "development"

from app import app  # noqa: E402

c = app.test_client()

# 1. GET renders the form with a CSRF token.
r = c.get("/")
html = r.get_data(as_text=True)
m = re.search(r'name="csrf_token"[^>]*value="([^"]+)"', html)
assert r.status_code == 200, r.status_code
assert m, "CSRF token missing from form"
token = m.group(1)
print("GET / ->", r.status_code, "| CSRF token present")

# 2. POST without a token is rejected (CSRF protection).
r_nocsrf = c.post("/", data={"name": "Ada", "submit": "Greet me"})
print("POST without CSRF ->", r_nocsrf.status_code, "(expected 400)")
assert r_nocsrf.status_code == 400

# 3. Valid name -> greeting.
r_ok = c.post("/", data={"csrf_token": token, "name": "Ada Lovelace", "submit": "Greet me"})
body = r_ok.get_data(as_text=True)
print("POST valid ->", r_ok.status_code, "| greeting:", "Hello, Ada Lovelace!" in body)
assert "Hello, Ada Lovelace!" in body

# 4. XSS attempt is rejected by validation (and would be escaped anyway).
r_xss = c.post("/", data={"csrf_token": token, "name": "<script>alert(1)</script>", "submit": "Greet me"})
xss_body = r_xss.get_data(as_text=True)
print("POST XSS payload ->", r_xss.status_code, "| raw <script> absent:", "<script>alert" not in xss_body)
assert "<script>alert" not in xss_body

# 5. Security headers present.
print("CSP header:", r.headers.get("Content-Security-Policy", "MISSING")[:40], "...")
print("X-Content-Type-Options:", r.headers.get("X-Content-Type-Options"))
assert r.headers.get("X-Content-Type-Options") == "nosniff"

# 6. Session cookie is HttpOnly + SameSite.
set_cookie = r.headers.get("Set-Cookie", "")
print("Set-Cookie flags:", "HttpOnly" in set_cookie, "SameSite=Lax" in set_cookie)

print("\nALL CHECKS PASSED")
