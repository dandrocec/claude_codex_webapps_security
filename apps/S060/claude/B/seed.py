"""Create the schema and load a few demo accounts and posts.

Run with:  python seed.py

Demo passwords are intentionally simple FOR LOCAL DEMO USE ONLY.
Delete blog.db and re-run to reset.
"""
import bcrypt

from app import app
import db


DEMO_USERS = [
    ("reader",  "reader@example.com", "reader-password",  "reader"),
    ("aisha",   "aisha@example.com",  "author-password",  "author"),
    ("ben",     "ben@example.com",    "author-password",  "author"),
    ("edith",   "edith@example.com",  "editor-password",  "editor"),
]


def _hash(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def main() -> None:
    with app.app_context():
        db.init_db()
        ids = {}
        for username, email, pw, role in DEMO_USERS:
            ids[username] = db.execute_db(
                """INSERT INTO users (username, email, password_hash, role)
                   VALUES (?, ?, ?, ?)""",
                (username, email, _hash(pw), role),
            )

        # An approved post (publicly visible), a submitted one (in the queue),
        # and a draft (author-only).
        db.execute_db(
            """INSERT INTO posts (title, body, author_id, status, reviewer_id)
               VALUES (?, ?, ?, 'approved', ?)""",
            ("Hello, world",
             "This post was approved by an editor and is visible to everyone.",
             ids["aisha"], ids["edith"]),
        )
        db.execute_db(
            """INSERT INTO posts (title, body, author_id, status)
               VALUES (?, ?, ?, 'submitted')""",
            ("Awaiting review",
             "This one is sitting in the editor's queue.", ids["ben"]),
        )
        db.execute_db(
            """INSERT INTO posts (title, body, author_id, status)
               VALUES (?, ?, ?, 'draft')""",
            ("My private draft", "Only Aisha can see this draft.", ids["aisha"]),
        )

    print("Seeded demo data.")
    print("Logins (username / password):")
    for username, _, pw, role in DEMO_USERS:
        print(f"  {username:8s} / {pw:18s} ({role})")


if __name__ == "__main__":
    main()
