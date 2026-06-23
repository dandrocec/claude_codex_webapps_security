"""Quick in-process smoke test of the core flows and access control.

Run with:  python smoke_test.py
Uses a throwaway temp database/uploads dir; does not touch recruiting.db.
"""
import io
import os
import tempfile

os.environ["SECRET_KEY"] = "test"

import app as app_module
from models import db

# Point at a temp DB + uploads dir so we don't clobber real data.
tmp = tempfile.mkdtemp()
flask_app = app_module.create_app()
flask_app.config.update(
    TESTING=True,
    SQLALCHEMY_DATABASE_URI="sqlite:///" + os.path.join(tmp, "test.db"),
    UPLOAD_DIR=os.path.join(tmp, "uploads"),
    WTF_CSRF_ENABLED=False,
)
os.makedirs(flask_app.config["UPLOAD_DIR"], exist_ok=True)
with flask_app.app_context():
    db.drop_all()
    db.create_all()


def client():
    return flask_app.test_client()


def register(c, name, email, role):
    return c.post("/register", data={
        "name": name, "email": email, "password": "secret1", "role": role
    }, follow_redirects=True)


passed = 0


def check(cond, label):
    global passed
    assert cond, "FAILED: " + label
    passed += 1
    print("  ok -", label)


# Employer posts a job
emp = client()
register(emp, "Acme", "emp@x.com", "employer")
r = emp.post("/jobs/new", data={"title": "Engineer", "location": "Remote",
                                "description": "Build things"},
             follow_redirects=True)
check(b"Applications for Engineer" in r.data, "employer can post a job")

# Applicant A applies with a resume
a1 = client()
register(a1, "Alice", "alice@x.com", "applicant")
r = a1.post("/jobs/1/apply", data={
    "cover_letter": "Hire me",
    "resume": (io.BytesIO(b"my resume"), "alice.pdf"),
}, content_type="multipart/form-data", follow_redirects=True)
check(b"Your applications" in r.data and b"Engineer" in r.data,
      "applicant can apply with a resume")

# Duplicate application is blocked
r = a1.post("/jobs/1/apply", data={
    "cover_letter": "again",
    "resume": (io.BytesIO(b"x"), "alice2.pdf"),
}, content_type="multipart/form-data", follow_redirects=True)
check(b"already applied" in r.data, "duplicate application blocked")

# Applicant B applies too
a2 = client()
register(a2, "Bob", "bob@x.com", "applicant")
a2.post("/jobs/1/apply", data={
    "cover_letter": "me too",
    "resume": (io.BytesIO(b"bob resume"), "bob.pdf"),
}, content_type="multipart/form-data", follow_redirects=True)

# Employer sees both applications
r = emp.get("/jobs/1/applications")
check(b"Alice" in r.data and b"Bob" in r.data,
      "employer sees applications for own job")

# Employer can download a resume submitted to their job
check(emp.get("/applications/1/resume").status_code == 200,
      "owning employer can download resume")

# Applicant B cannot read Applicant A's resume (app id 1 is Alice's)
check(a2.get("/applications/1/resume").status_code == 403,
      "applicant cannot read another applicant's resume")

# Applicant cannot view the employer's applications list
check(a1.get("/jobs/1/applications").status_code == 403,
      "applicant blocked from employer review page")

# A second employer cannot review the first employer's job applications
emp2 = client()
register(emp2, "Beta", "emp2@x.com", "employer")
check(emp2.get("/jobs/1/applications").status_code == 403,
      "employer cannot review another employer's job")
check(emp2.get("/applications/1/resume").status_code == 403,
      "employer cannot download resume for another employer's job")

# Applicant can download their own resume
check(a1.get("/applications/1/resume").status_code == 200,
      "applicant can download own resume")

# Unauthenticated access is redirected to login
anon = client()
check(anon.get("/dashboard").status_code in (301, 302),
      "anonymous user redirected from dashboard")

print(f"\nAll {passed} checks passed.")
