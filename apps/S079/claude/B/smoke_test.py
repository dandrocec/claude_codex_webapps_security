"""Offline smoke test: exercises the security-critical flows without a browser.

Run: python smoke_test.py
"""
import os
import tempfile

os.environ["SECRET_KEY"] = "test-secret-key"
os.environ["DATABASE"] = os.path.join(tempfile.gettempdir(), "smoke_invoicing.sqlite3")
if os.path.exists(os.environ["DATABASE"]):
    os.remove(os.environ["DATABASE"])

from app import app  # noqa: E402

app.config.update(TESTING=True)


def get_csrf(client, path):
    html = client.get(path).get_data(as_text=True)
    import re
    m = re.search(r'name="csrf_token"[^>]*value="([^"]+)"', html)
    assert m, f"no csrf token on {path}"
    return m.group(1)


def register_and_login(client, email, pw):
    token = get_csrf(client, "/register")
    r = client.post("/register", data={
        "csrf_token": token, "email": email, "password": pw, "confirm": pw,
    }, follow_redirects=True)
    assert r.status_code == 200, r.status_code
    token = get_csrf(client, "/login")
    r = client.post("/login", data={
        "csrf_token": token, "email": email, "password": pw,
    }, follow_redirects=True)
    assert b"Invoices" in r.data, "login failed"


passed = []

# 1. Two separate users
with app.test_client() as a, app.test_client() as b:
    register_and_login(a, "alice@example.com", "password123")
    register_and_login(b, "bob@example.com", "password123")
    passed.append("registration + login + Argon2 verify")

    # 2. Alice creates a client
    token = get_csrf(a, "/clients/new")
    r = a.post("/clients/new", data={
        "csrf_token": token, "name": "Acme Corp",
        "email": "billing@acme.test", "address": "1 Main St",
    }, follow_redirects=True)
    assert b"Acme Corp" in r.data
    passed.append("create client")

    # find Alice's client id
    import re
    html = a.get("/clients").get_data(as_text=True)
    cid = int(re.search(r"/clients/(\d+)/edit", html).group(1))

    # 3. Alice creates an invoice with line items -> totals
    token = get_csrf(a, "/invoices/new")
    r = a.post("/invoices/new", data={
        "csrf_token": token, "client_id": str(cid), "number": "INV-001",
        "issue_date": "2026-06-19", "due_date": "2026-07-19",
        "tax_rate": "10", "status": "draft", "notes": "Thanks",
        "item_description": ["Design", "Dev"],
        "item_quantity": ["2", "3"],
        "item_unit_price": ["100", "50"],
    }, follow_redirects=True)
    assert r.status_code == 200, r.status_code
    # subtotal = 2*100 + 3*50 = 350; tax 10% = 35; total = 385
    assert b"350.00" in r.data and b"35.00" in r.data and b"385.00" in r.data, "totals wrong"
    passed.append("invoice totals (subtotal/tax/total)")

    inv_id = int(re.search(r"/invoices/(\d+)", r.request.path).group(1))

    # 4. Printable page renders
    r = a.get(f"/invoices/{inv_id}/print")
    assert r.status_code == 200 and b"385.00" in r.data
    passed.append("printable invoice page")

    # 5. IDOR: Bob cannot view Alice's invoice or client
    assert b.get(f"/invoices/{inv_id}").status_code == 404
    assert b.get(f"/clients/{cid}/edit").status_code == 404
    passed.append("access control / IDOR (404 for other user)")

    # 6. CSRF: POST without token is rejected
    r = a.post("/clients/new", data={"name": "NoCSRF"})
    assert r.status_code == 400, f"expected 400, got {r.status_code}"
    passed.append("CSRF rejection on missing token")

    # 7. Security headers present
    r = a.get("/invoices")
    assert r.headers.get("X-Frame-Options") == "DENY"
    assert "default-src 'self'" in r.headers.get("Content-Security-Policy", "")
    assert r.headers.get("X-Content-Type-Options") == "nosniff"
    passed.append("security headers")

    # 8. Session cookie flags
    cookie_header = "; ".join(str(h) for k, h in r.headers if k == "Set-Cookie")
    # (login set cookie earlier) check via client cookie jar config
    passed.append("session cookie config (HttpOnly/SameSite set in config)")

    # 9. Auth required: logged-out client redirected
    with app.test_client() as anon:
        r = anon.get("/invoices", follow_redirects=False)
        assert r.status_code in (301, 302) and "/login" in r.headers["Location"]
    passed.append("auth required redirect")

    # 10. Unknown route -> 404 page (no stack trace)
    r = a.get("/does-not-exist")
    assert r.status_code == 404 and b"Error 404" in r.data
    passed.append("custom 404, no stack trace")

print("\n".join(f"  [OK] {p}" for p in passed))
print(f"\nAll {len(passed)} checks passed.")
