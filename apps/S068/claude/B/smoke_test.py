"""End-to-end smoke test exercising the full booking flow against the app's
test client. Run after installing requirements. Exits non-zero on failure.
"""
import os
import re

os.environ["SECURE_COOKIES"] = "0"
os.environ["FLASK_SECRET_KEY"] = "test-secret-key-for-smoke-only"
os.environ["DATABASE_PATH"] = os.path.join(os.path.dirname(__file__), "instance", "smoke.sqlite3")

# Fresh DB each run.
if os.path.exists(os.environ["DATABASE_PATH"]):
    os.remove(os.environ["DATABASE_PATH"])

from app import app  # noqa: E402

TOKEN_RE = re.compile(rb'name="csrf_token"[^>]*value="([^"]+)"')


def csrf(client, path):
    html = client.get(path).data
    m = TOKEN_RE.search(html)
    assert m, f"no csrf token on {path}"
    return m.group(1).decode()


def register(client, email, password, role):
    tok = csrf(client, "/register")
    return client.post("/register", data={
        "csrf_token": tok, "email": email, "password": password,
        "confirm": password, "role": role,
    }, follow_redirects=True)


def login(client, email, password):
    tok = csrf(client, "/login")
    return client.post("/login", data={
        "csrf_token": tok, "email": email, "password": password,
    }, follow_redirects=True)


def main():
    PW = "Sup3rSecret!pw"
    prov = app.test_client()
    cli = app.test_client()

    # --- Provider registers, logs in, publishes a slot.
    assert b"Please log in" in register(prov, "prov@example.com", PW, "provider").data
    login(prov, "prov@example.com", PW)
    tok = csrf(prov, "/provider/slots")
    r = prov.post("/provider/slots", data={
        "csrf_token": tok,
        "start_time": "2030-01-01T10:00",
        "end_time": "2030-01-01T11:00",
    }, follow_redirects=True)
    assert b"Slot published" in r.data, "slot not published"

    # --- Client registers, logs in, sees the open slot.
    register(cli, "client@example.com", PW, "client")
    login(cli, "client@example.com", PW)
    r = cli.get("/slots")
    assert b"prov@example.com" in r.data, "open slot not visible to client"
    m = re.search(rb"/slots/(\d+)/book", r.data)
    assert m, "no book button"
    slot_id = int(m.group(1))

    # --- Book it -> confirmation.
    tok = csrf(cli, "/slots")
    r = cli.post(f"/slots/{slot_id}/book", data={"csrf_token": tok}, follow_redirects=True)
    assert b"Booking confirmed" in r.data, "no booking confirmation"
    assert b"prov@example.com" in cli.get("/appointments").data

    # --- Double-booking prevented: a second client cannot book the same slot.
    cli2 = app.test_client()
    register(cli2, "client2@example.com", PW, "client")
    login(cli2, "client2@example.com", PW)
    tok = csrf(cli2, "/slots")
    r = cli2.post(f"/slots/{slot_id}/book", data={"csrf_token": tok}, follow_redirects=True)
    assert b"no longer available" in r.data, "double booking was NOT prevented!"

    # --- CSRF protection: POST without token is rejected.
    r = cli2.post(f"/slots/{slot_id}/book", data={})
    assert r.status_code == 400, f"missing-CSRF POST should be 400, got {r.status_code}"

    # --- Access control: client cannot reach provider area.
    assert cli.get("/provider/slots").status_code == 403, "IDOR/role check failed"

    # --- IDOR: a different client cannot cancel someone else's booking.
    tok = csrf(cli2, "/appointments")
    r = cli2.post(f"/appointments/{slot_id}/cancel", data={"csrf_token": tok}, follow_redirects=True)
    assert b"could not be cancelled" in r.data, "IDOR cancel not blocked"

    # --- Provider sees who booked the slot.
    assert b"client@example.com" in prov.get("/provider/slots").data

    # --- Security headers present.
    h = cli.get("/login").headers
    assert "Content-Security-Policy" in h
    assert h.get("X-Frame-Options") == "DENY"
    assert h.get("X-Content-Type-Options") == "nosniff"

    # --- Passwords are not stored in plaintext.
    import sqlite3
    con = sqlite3.connect(os.environ["DATABASE_PATH"])
    stored = con.execute("SELECT password_hash FROM users LIMIT 1").fetchone()[0]
    assert stored.startswith("$argon2"), "password not Argon2-hashed"
    assert PW not in stored

    print("ALL SMOKE TESTS PASSED")


if __name__ == "__main__":
    main()
