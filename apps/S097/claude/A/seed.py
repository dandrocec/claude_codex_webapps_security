"""Populate the database with an admin user, a demo customer, and products.

Run with:  python seed.py
Idempotent: it will not duplicate rows that already exist (matched by email/name).
"""

from app import app
from models import Product, User, db

PRODUCTS = [
    ("Aurora Wireless Headphones", "Over-ear noise-cancelling headphones with 30h battery.", 19900, 25, "Audio", "https://picsum.photos/seed/headphones/600/400"),
    ("Nimbus Mechanical Keyboard", "Hot-swappable 75% keyboard with tactile switches.", 12900, 40, "Accessories", "https://picsum.photos/seed/keyboard/600/400"),
    ("Pulse Smartwatch", "Fitness tracking, heart-rate, and GPS in a slim design.", 24900, 15, "Wearables", "https://picsum.photos/seed/watch/600/400"),
    ("Vertex 4K Monitor", "27-inch IPS display with 99% sRGB and USB-C.", 34900, 10, "Displays", "https://picsum.photos/seed/monitor/600/400"),
    ("Cobalt USB-C Hub", "7-in-1 hub: HDMI, USB 3.0, SD, and 100W PD.", 5900, 60, "Accessories", "https://picsum.photos/seed/hub/600/400"),
    ("Echo Bluetooth Speaker", "Portable waterproof speaker with deep bass.", 8900, 3, "Audio", "https://picsum.photos/seed/speaker/600/400"),
    ("Lumen Desk Lamp", "Dimmable LED lamp with wireless charging base.", 4900, 35, "Home", "https://picsum.photos/seed/lamp/600/400"),
    ("Drift Ergonomic Mouse", "Vertical wireless mouse for all-day comfort.", 4500, 50, "Accessories", "https://picsum.photos/seed/mouse/600/400"),
    ("Strata Laptop Stand", "Aluminium adjustable stand for laptops up to 17 inches.", 3900, 5, "Home", "https://picsum.photos/seed/stand/600/400"),
    ("Quanta Power Bank", "20,000mAh fast-charge bank with dual USB-C.", 5500, 0, "Accessories", "https://picsum.photos/seed/powerbank/600/400"),
]


def seed():
    with app.app_context():
        db.create_all()

        if not User.query.filter_by(email="admin@shop.test").first():
            admin = User(name="Store Admin", email="admin@shop.test", is_admin=True)
            admin.set_password("admin123")
            db.session.add(admin)
            print("Created admin: admin@shop.test / admin123")

        if not User.query.filter_by(email="customer@shop.test").first():
            customer = User(name="Demo Customer", email="customer@shop.test")
            customer.set_password("customer123")
            db.session.add(customer)
            print("Created customer: customer@shop.test / customer123")

        created = 0
        for name, desc, price_cents, stock, category, image in PRODUCTS:
            if not Product.query.filter_by(name=name).first():
                db.session.add(
                    Product(
                        name=name,
                        description=desc,
                        price_cents=price_cents,
                        stock=stock,
                        category=category,
                        image_url=image,
                    )
                )
                created += 1

        db.session.commit()
        print(f"Seeded {created} new product(s). Total products: {Product.query.count()}")


if __name__ == "__main__":
    seed()
