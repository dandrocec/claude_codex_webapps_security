"""Initialise the database and create demo accounts.

Run once after installing dependencies:

    python seed.py

Creates:
  * an agent   — agent@example.com   / AgentPass123
  * a customer — customer@example.com / CustomerPass123

Passwords here are for LOCAL DEMO ONLY. Change or remove for any real use.
"""
import sqlite3

from app import create_app
from db import get_db, init_db
from security import hash_password

DEMO_USERS = [
    ("agent@example.com", "Alex Agent", "AgentPass123", "agent"),
    ("customer@example.com", "Casey Customer", "CustomerPass123", "customer"),
]


def main() -> None:
    app = create_app()
    with app.app_context():
        init_db()
        db = get_db()
        for email, name, password, role in DEMO_USERS:
            try:
                db.execute(
                    "INSERT INTO users (email, name, password_hash, role) "
                    "VALUES (?, ?, ?, ?)",
                    (email, name, hash_password(password), role),
                )
                print(f"created {role}: {email}")
            except sqlite3.IntegrityError:
                print(f"skipped (exists): {email}")
        db.commit()
    print("\nDatabase ready.")


if __name__ == "__main__":
    main()
