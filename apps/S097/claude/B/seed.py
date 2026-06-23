"""Seed the database with an admin account and sample products.

Safe to run multiple times: it only inserts rows that don't already exist.
"""
import sqlite3

from flask import current_app

from db import get_db
from models import User, create_product

SAMPLE_PRODUCTS = [
    ("Aeropress Coffee Maker", "Brews smooth, rich coffee in under a minute.", 3499, 40),
    ("Ceramic Pour-Over Dripper", "Single-cup pour-over in matte stoneware.", 2199, 25),
    ("Burr Coffee Grinder", "40mm conical burrs with 30 grind settings.", 8999, 15),
    ("Gooseneck Kettle (1L)", "Precision pour spout, stovetop safe.", 4599, 30),
    ("Reusable Glass Bottle", "Borosilicate glass with bamboo lid, 600ml.", 1899, 100),
    ("Organic Espresso Beans 1kg", "Dark roast, fair-trade single origin.", 2499, 60),
]


def seed_data():
    db = get_db()

    # Admin account (credentials from environment / config).
    admin_email = current_app.config["ADMIN_EMAIL"].strip().lower()
    if User.get_by_email(admin_email) is None:
        User.create(
            admin_email,
            "Store Admin",
            current_app.config["ADMIN_PASSWORD"],
            is_admin=True,
        )
        print(f"Created admin user: {admin_email}")

    # Sample products (skip if any already exist).
    existing = db.execute("SELECT COUNT(*) AS n FROM product").fetchone()["n"]
    if existing == 0:
        for name, desc, price_cents, stock in SAMPLE_PRODUCTS:
            create_product(name, desc, price_cents, stock)
        print(f"Inserted {len(SAMPLE_PRODUCTS)} sample products.")


if __name__ == "__main__":
    # Allow `python seed.py` by building a throwaway app context.
    from app import create_app

    app = create_app()
    with app.app_context():
        seed_data()
