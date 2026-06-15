#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "== Creating virtual environment =="
python -m venv .venv

PY=".venv/Scripts/python.exe"
[ -x "$PY" ] || PY=".venv/bin/python"

echo "== Installing dependencies =="
"$PY" -m pip install --quiet --upgrade pip
"$PY" -m pip install --quiet -r requirements.txt

echo "== Compiling all modules (syntax check) =="
"$PY" -m py_compile app.py config.py db.py forms.py

echo "== Smoke test: import app, exercise register/login/entry flow =="
SECRET_KEY=$("$PY" -c "import secrets;print(secrets.token_hex(32))")
export SECRET_KEY
export SESSION_COOKIE_SECURE=false
export DATABASE_PATH=":memory:"
"$PY" - <<'PYEOF'
import os
os.environ.setdefault("SECRET_KEY", "x"*64)
from app import create_app
from config import Config

class T(Config):
    WTF_CSRF_ENABLED = False           # disable CSRF for the test client
    DATABASE = "file:smoketest?mode=memory&cache=shared"

app = create_app(T)
app.config["TESTING"] = True
c = app.test_client()

# register
r = c.post("/register", data={"username":"alice","password":"hunter2pw","confirm":"hunter2pw"}, follow_redirects=True)
assert r.status_code == 200, r.status_code
# login
r = c.post("/login", data={"username":"alice","password":"hunter2pw"}, follow_redirects=True)
assert b"Log time" in r.data, "login failed"
# add entry
r = c.post("/entries", data={"project":"Acme <b>","entry_date":"2026-06-15","hours":"3.5","note":"<script>x</script>"}, follow_redirects=True)
assert r.status_code == 200
# verify XSS payload is escaped in output
assert b"<script>x</script>" not in r.data, "XSS not escaped!"
assert b"&lt;script&gt;" in r.data, "expected escaped output"
# weekly total present
assert b"3.50" in r.data, "total missing"

# IDOR: second user cannot delete alice's entry
c2 = app.test_client()
c2.post("/register", data={"username":"bob","password":"hunter2pw","confirm":"hunter2pw"}, follow_redirects=True)
c2.post("/login", data={"username":"bob","password":"hunter2pw"}, follow_redirects=True)
# find alice's entry id
with app.app_context():
    import db
    eid = db.get_db().execute("SELECT id FROM entries LIMIT 1").fetchone()["id"]
r = c2.post(f"/entries/{eid}/delete")
assert r.status_code == 403, f"IDOR not blocked: {r.status_code}"

# security headers
r = c.get("/login")
assert "Content-Security-Policy" in r.headers
assert r.headers.get("X-Frame-Options") == "DENY"

print("SMOKE_TEST_OK")
PYEOF
echo "== DONE =="
