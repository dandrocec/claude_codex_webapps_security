"""End-to-end smoke test exercising the full flow via the WSGI test client.

Run:  python smoke_test.py
Uses a temporary SQLite file and the built-in sandbox payment provider.
"""
import os
import re
import tempfile

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-smoke")
os.environ.setdefault("WEBHOOK_SECRET", "test-webhook-secret-for-smoke")
os.environ.setdefault("PAYMENT_PROVIDER", "sandbox")
_db_fd, _db_path = tempfile.mkstemp(suffix=".db")
os.close(_db_fd)
os.environ["DATABASE_PATH"] = _db_path

from app import create_app          # noqa: E402
from db import get_db, init_db      # noqa: E402
from models import create_user      # noqa: E402

app = create_app()
failures = []


def check(name, cond):
    print(("PASS" if cond else "FAIL"), "-", name)
    if not cond:
        failures.append(name)


def csrf_token(html):
    m = re.search(r'name="csrf_token"[^>]*value="([^"]+)"', html)
    assert m, "no csrf token found in page"
    return m.group(1)


with app.app_context():
    init_db()
    db = get_db()
    db.execute("INSERT INTO products (name, description, price_cents, stock) "
               "VALUES ('Widget', 'A widget', 1500, 10)")
    db.commit()
    pid = db.execute("SELECT id FROM products").fetchone()["id"]
    create_user("admin@example.com", "adminpassword123", is_admin=True)

# --- Anonymous browsing ------------------------------------------------------
c = app.test_client()
r = c.get("/")
check("home page loads", r.status_code == 200 and b"Widget" in r.data)

r = c.get(f"/product/{pid}")
check("product page loads", r.status_code == 200)

# --- Security: SQLi attempt is harmless --------------------------------------
r = c.get("/product/1%20OR%201=1")
check("SQLi-style product id is not matched (404)", r.status_code == 404)

# --- Register + login --------------------------------------------------------
r = c.get("/register")
token = csrf_token(r.get_data(as_text=True))
r = c.post("/register", data={
    "csrf_token": token, "email": "user@example.com",
    "password": "correcthorsebattery", "confirm": "correcthorsebattery",
}, follow_redirects=True)
check("registration succeeds", r.status_code == 200)

# CSRF: posting without a token is rejected
r = c.post("/register", data={"email": "x@y.com", "password": "a", "confirm": "a"})
check("registration without CSRF token rejected", r.status_code == 400)

r = c.get("/login")
token = csrf_token(r.get_data(as_text=True))
r = c.post("/login", data={
    "csrf_token": token, "email": "user@example.com",
    "password": "correcthorsebattery",
}, follow_redirects=True)
check("login succeeds", r.status_code == 200 and b"My orders" in r.data)

# --- Add to cart + checkout --------------------------------------------------
r = c.get(f"/product/{pid}")
token = csrf_token(r.get_data(as_text=True))
r = c.post("/cart/add", data={
    "csrf_token": token, "product_id": str(pid), "quantity": "2",
}, follow_redirects=True)
check("add to cart works", r.status_code == 200 and b"$30.00" in r.data)

r = c.get("/cart")
token = csrf_token(r.get_data(as_text=True))
r = c.post("/checkout", data={"csrf_token": token}, follow_redirects=False)
check("checkout redirects to sandbox pay", r.status_code == 302 and "/sandbox/pay/" in r.headers["Location"])
pay_path = r.headers["Location"].split("localhost:5089", 1)[-1]

# --- Pay via sandbox (delivers signed webhook) -------------------------------
r = c.get(pay_path)
token = csrf_token(r.get_data(as_text=True))
r = c.post(pay_path, data={"csrf_token": token}, follow_redirects=True)
check("payment marks order paid", r.status_code == 200 and b"Payment received" in r.data)

with app.app_context():
    o = get_db().execute("SELECT * FROM orders").fetchone()
    check("order persisted as paid with correct total",
          o["status"] == "paid" and o["total_cents"] == 3000)
    order_id = o["id"]

# --- Webhook signature enforcement ------------------------------------------
r = c.post("/webhook", data=b'{"type":"payment.succeeded","data":{"payment_ref":"x"}}',
           headers={"Content-Type": "application/json", "X-Signature": "t=1,v1=bad"})
check("webhook with bad signature rejected", r.status_code == 400)

# --- IDOR: another user cannot see the first user's order --------------------
c2 = app.test_client()
r = c2.get("/register")
token = csrf_token(r.get_data(as_text=True))
c2.post("/register", data={"csrf_token": token, "email": "mallory@example.com",
        "password": "anotherpassword12", "confirm": "anotherpassword12"},
        follow_redirects=True)
r = c2.get("/login")
token = csrf_token(r.get_data(as_text=True))
c2.post("/login", data={"csrf_token": token, "email": "mallory@example.com",
        "password": "anotherpassword12"}, follow_redirects=True)
r = c2.get(f"/orders/{order_id}")
check("IDOR blocked: other user gets 404 on foreign order", r.status_code == 404)

# --- Access control: non-admin cannot reach admin ----------------------------
r = c2.get("/admin/orders")
check("non-admin forbidden from admin list", r.status_code == 403)

# --- Admin can list all orders -----------------------------------------------
ca = app.test_client()
r = ca.get("/login")
token = csrf_token(r.get_data(as_text=True))
ca.post("/login", data={"csrf_token": token, "email": "admin@example.com",
        "password": "adminpassword123"}, follow_redirects=True)
r = ca.get("/admin/orders")
check("admin can view all orders", r.status_code == 200 and b"user@example.com" in r.data)

# --- Security headers + cookie flags -----------------------------------------
r = c.get("/")
check("CSP header present", "Content-Security-Policy" in r.headers)
check("X-Frame-Options DENY", r.headers.get("X-Frame-Options") == "DENY")
check("nosniff header present", r.headers.get("X-Content-Type-Options") == "nosniff")

r = app.test_client().get("/login")
set_cookie = r.headers.get("Set-Cookie", "")
check("session cookie HttpOnly", "HttpOnly" in set_cookie)
check("session cookie SameSite", "SameSite" in set_cookie)

print()
if failures:
    print(f"{len(failures)} FAILED:", failures)
    raise SystemExit(1)
print("ALL CHECKS PASSED")
os.unlink(_db_path) if os.path.exists(_db_path) else None
