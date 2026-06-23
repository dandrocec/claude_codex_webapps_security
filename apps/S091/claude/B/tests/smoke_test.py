"""Offline smoke test: exercises auth, posting, timeline fan-out, access control
and the SSRF guard without binding a port or making external network calls.

Run:  python -m tests.smoke_test
"""
import os
import time
import tempfile

# Use a throwaway database and a fixed secret before importing the app.
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/microblog_smoke.db"
os.environ["SECRET_KEY"] = "smoke-test-secret"
os.environ["WORKER_ENABLED"] = "true"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.ssrf import SSRFError, _resolve_and_validate, _validate_url  # noqa: E402

failures = []


def check(name, cond):
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name}")
    if not cond:
        failures.append(name)


def csrf(client):
    return client.get("/api/csrf").json()["csrf_token"]


with TestClient(app) as client:
    # --- registration + login -------------------------------------------------
    t = csrf(client)
    r = client.post("/api/register", json={"username": "alice", "password": "supersecret1"},
                    headers={"X-CSRF-Token": t})
    check("register alice (201)", r.status_code == 201)

    r = client.post("/api/register", json={"username": "alice", "password": "supersecret1"},
                    headers={"X-CSRF-Token": csrf(client)})
    check("duplicate username rejected (409)", r.status_code == 409)

    r = client.post("/api/register", json={"username": "bad name!", "password": "supersecret1"},
                    headers={"X-CSRF-Token": csrf(client)})
    check("invalid username rejected (422)", r.status_code == 422)

    # CSRF enforcement: missing token must fail.
    r = client.post("/api/posts", json={"content": "no csrf"})
    check("missing CSRF rejected (403)", r.status_code == 403)

    r = client.post("/api/login", json={"username": "alice", "password": "wrongpass"},
                    headers={"X-CSRF-Token": csrf(client)})
    check("login wrong password (401)", r.status_code == 401)

    r = client.post("/api/login", json={"username": "alice", "password": "supersecret1"},
                    headers={"X-CSRF-Token": csrf(client)})
    check("login ok (200)", r.status_code == 200)

    # --- posting + timeline fan-out ------------------------------------------
    r = client.post("/api/posts", json={"content": "hello <script>alert(1)</script> world"},
                    headers={"X-CSRF-Token": csrf(client)})
    check("create post (201)", r.status_code == 201)
    post_id = r.json()["id"]

    # Worker fans out asynchronously; poll the timeline briefly.
    found = False
    for _ in range(30):
        r = client.get("/api/timeline")
        if r.status_code == 200 and any(p["id"] == post_id for p in r.json()["posts"]):
            found = True
            break
        time.sleep(0.2)
    check("post appears in own timeline (worker fan-out)", found)

    # Stored content is preserved verbatim; the HTML UI escapes it on render.
    html = client.get("/").text
    check("rendered HTML escapes script tag (XSS)", "<script>alert(1)</script>" not in html
          and "&lt;script&gt;" in html)

    # --- security headers -----------------------------------------------------
    h = client.get("/").headers
    check("CSP header present", "content-security-policy" in {k.lower() for k in h.keys()})
    check("X-Frame-Options DENY", h.get("x-frame-options") == "DENY")
    check("X-Content-Type-Options nosniff", h.get("x-content-type-options") == "nosniff")

    # --- session cookie hardening --------------------------------------------
    set_cookie = ""
    rc = client.get("/api/csrf")
    set_cookie = rc.headers.get("set-cookie", "")
    # (On a fresh client the very first call sets the cookie.)
    with TestClient(app) as fresh:
        sc = fresh.get("/api/csrf").headers.get("set-cookie", "")
    check("session cookie HttpOnly", "httponly" in sc.lower())
    check("session cookie SameSite", "samesite" in sc.lower())

    # --- access control / IDOR ------------------------------------------------
    with TestClient(app) as mallory:
        mallory.post("/api/register", json={"username": "mallory", "password": "supersecret1"},
                     headers={"X-CSRF-Token": csrf(mallory)})
        mallory.post("/api/login", json={"username": "mallory", "password": "supersecret1"},
                     headers={"X-CSRF-Token": csrf(mallory)})
        r = mallory.delete(f"/api/posts/{post_id}", headers={"X-CSRF-Token": csrf(mallory)})
        check("non-owner cannot delete post (404)", r.status_code == 404)

    # owner can delete
    r = client.delete(f"/api/posts/{post_id}", headers={"X-CSRF-Token": csrf(client)})
    check("owner can delete own post (200)", r.status_code == 200)

# --- SSRF guard (no network: literal IPs / metadata) -------------------------
def blocked(url):
    try:
        _validate_url(url)
        return False
    except SSRFError:
        return True


check("SSRF blocks cloud metadata 169.254.169.254", blocked("http://169.254.169.254/latest/meta-data/"))
check("SSRF blocks loopback 127.0.0.1", blocked("http://127.0.0.1:8080/"))
check("SSRF blocks private 10.0.0.5", blocked("http://10.0.0.5/"))
check("SSRF blocks private 192.168.1.1", blocked("https://192.168.1.1/"))
check("SSRF blocks IPv6 loopback ::1", blocked("http://[::1]/"))
check("SSRF blocks ULA fc00::1", blocked("http://[fc00::1]/"))
check("SSRF blocks file:// scheme", blocked("file:///etc/passwd"))
check("SSRF blocks gopher:// scheme", blocked("gopher://127.0.0.1/"))
check("SSRF blocks IPv4-mapped ::ffff:127.0.0.1",
      blocked("http://[::ffff:127.0.0.1]/"))

print("\nRESULT:", "ALL PASSED" if not failures else f"{len(failures)} FAILED -> {failures}")
raise SystemExit(1 if failures else 0)
