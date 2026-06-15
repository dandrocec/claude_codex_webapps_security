"""Quick smoke test: exercises the main flows and security controls."""
import re

import app as a

c = a.app.test_client()


def csrf(html: bytes) -> str:
    return re.search(rb'name="csrf_token" value="([^"]+)"', html).group(1).decode()


r = c.get("/")
assert r.status_code == 200, r.status_code
print("GET / ->", r.status_code)

tok = csrf(r.data)
r = c.post("/", data={"csrf_token": tok, "content": "https://example.com"})
assert r.status_code == 200 and b"data:image/png;base64," in r.data
print("POST / (generate) ->", r.status_code, "| QR image embedded: True")

tok2 = csrf(c.get("/").data)
r = c.post("/download", data={"csrf_token": tok2, "content": "hello world"})
is_png = r.data[:8] == b"\x89PNG\r\n\x1a\n"
assert r.status_code == 200 and r.mimetype == "image/png" and is_png
print("POST /download ->", r.status_code, r.mimetype, len(r.data), "bytes | valid PNG:", is_png)

r = c.post("/download", data={"content": "no token"})
assert r.status_code == 400
print("POST /download without CSRF ->", r.status_code, "(rejected)")

r = c.get("/")
assert "Content-Security-Policy" in r.headers
assert r.headers.get("X-Frame-Options") == "DENY"
print("Security headers -> CSP:", "Content-Security-Policy" in r.headers,
      "| X-Frame-Options:", r.headers.get("X-Frame-Options"),
      "| X-Content-Type-Options:", r.headers.get("X-Content-Type-Options"))

r = c.get("/history")
assert r.status_code in (302, 401)
print("GET /history (anonymous) ->", r.status_code, "(access control: login required)")

cookie = r.headers.get("Set-Cookie", "")
print("Session cookie flags ->", "HttpOnly:", "HttpOnly" in cookie, "| SameSite:", "SameSite" in cookie)

print("ALL_OK")
