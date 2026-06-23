"""Initialise the database schema and load sample products.

Idempotent: it only inserts sample products if the table is empty, so it is
safe to run more than once.
"""

import db

SAMPLE_PRODUCTS = [
    ("Ceramic Pour-Over Coffee Dripper", 2400,
     "Hand-glazed stoneware dripper for a clean, balanced cup. Fits standard #2 filters."),
    ("Stainless Steel Pour-Over Kettle", 5900,
     "1L gooseneck kettle with a precise spout for controlled pouring."),
    ("Burr Coffee Grinder", 8900,
     "Conical burr grinder with 30 grind settings, from espresso to French press."),
    ("Organic Single-Origin Beans (250g)", 1500,
     "Washed Ethiopian beans with notes of jasmine, citrus and stone fruit."),
    ("Reusable Stainless Filter", 1800,
     "Zero-waste mesh filter that fits most pour-over drippers."),
    ("Insulated Travel Tumbler (350ml)", 2200,
     "Double-walled vacuum tumbler that keeps drinks hot for up to 6 hours."),
]


def main():
    db.init_db()
    existing = db.query_one("SELECT COUNT(*) AS n FROM products")
    if existing["n"] > 0:
        print(f"Products already present ({existing['n']} rows); nothing to seed.")
        return
    for name, price_cents, description in SAMPLE_PRODUCTS:
        db.execute(
            "INSERT INTO products (name, price_cents, description) VALUES (?, ?, ?)",
            (name, price_cents, description),
        )
    print(f"Seeded {len(SAMPLE_PRODUCTS)} products.")


if __name__ == "__main__":
    main()
