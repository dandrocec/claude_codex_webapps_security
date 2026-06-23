"""Optional: seed the database with demo accounts and a sample page.

Run once after install:  python seed.py
Idempotent - it skips anything that already exists.
"""

from argon2 import PasswordHasher

import db

ph = PasswordHasher()

DEMO_USERS = [
    ("editor", "editor-pass-123", "editor"),
    ("viewer", "viewer-pass-123", "viewer"),
]


def main():
    db.init_db()
    conn = __import__("sqlite3").connect(db.DB_PATH)
    conn.row_factory = __import__("sqlite3").Row
    conn.execute("PRAGMA foreign_keys = ON;")

    ids = {}
    for username, password, role in DEMO_USERS:
        row = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        if row:
            ids[username] = row["id"]
            print(f"user '{username}' already exists, skipping")
            continue
        cur = conn.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            (username, ph.hash(password), role),
        )
        ids[username] = cur.lastrowid
        print(f"created {role} '{username}' (password: {password})")

    # Sample welcome page.
    if not conn.execute("SELECT 1 FROM pages WHERE slug = ?", ("welcome",)).fetchone():
        cur = conn.execute(
            "INSERT INTO pages (slug, title, editor_only, created_by) VALUES (?, ?, 0, ?)",
            ("welcome", "Welcome", ids["editor"]),
        )
        conn.execute(
            "INSERT INTO revisions (page_id, title, content, comment, author_id) "
            "VALUES (?, ?, ?, ?, ?)",
            (cur.lastrowid, "Welcome",
             "Welcome to the wiki!\n\nEditors can create and edit pages. "
             "Every edit is saved as a revision you can view and restore.",
             "Created page", ids["editor"]),
        )
        print("created sample 'welcome' page")

    conn.commit()
    conn.close()
    print("done.")


if __name__ == "__main__":
    main()
