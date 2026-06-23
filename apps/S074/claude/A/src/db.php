<?php

declare(strict_types=1);

/**
 * Returns a shared PDO connection to the SQLite database.
 * On first call it creates the database file, runs the schema migration
 * and seeds demo data so the app is runnable out of the box.
 */
function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $dataDir = dirname(__DIR__) . '/data';
    if (!is_dir($dataDir)) {
        mkdir($dataDir, 0777, true);
    }

    $dbFile = $dataDir . '/marketplace.sqlite';
    $isNew = !file_exists($dbFile);

    $pdo = new PDO('sqlite:' . $dbFile, null, null, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON');

    migrate($pdo);
    if ($isNew) {
        seed($pdo);
    }

    return $pdo;
}

/**
 * Creates the database tables if they do not yet exist.
 *
 * Statements are executed one at a time because multi-statement PDO::exec()
 * behaviour is not portable across all SQLite builds.
 */
function migrate(PDO $pdo): void
{
    $statements = [
        "CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT NOT NULL,
            email         TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role          TEXT NOT NULL CHECK (role IN ('vendor', 'buyer')),
            shop_name     TEXT,
            created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        )",

        "CREATE TABLE IF NOT EXISTS products (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            vendor_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name        TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
            stock       INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        )",

        "CREATE TABLE IF NOT EXISTS orders (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            buyer_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            total_cents INTEGER NOT NULL,
            status      TEXT NOT NULL DEFAULT 'paid',
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        )",

        // Each line item snapshots the vendor and price at purchase time so
        // that a vendor only ever sees the rows that belong to them.
        "CREATE TABLE IF NOT EXISTS order_items (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            product_id       INTEGER REFERENCES products(id) ON DELETE SET NULL,
            vendor_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            product_name     TEXT NOT NULL,
            unit_price_cents INTEGER NOT NULL,
            quantity         INTEGER NOT NULL CHECK (quantity > 0)
        )",

        "CREATE INDEX IF NOT EXISTS idx_products_vendor ON products(vendor_id)",
        "CREATE INDEX IF NOT EXISTS idx_items_vendor    ON order_items(vendor_id)",
        "CREATE INDEX IF NOT EXISTS idx_items_order     ON order_items(order_id)",
        "CREATE INDEX IF NOT EXISTS idx_orders_buyer    ON orders(buyer_id)",
    ];

    foreach ($statements as $sql) {
        $pdo->exec($sql);
    }
}

/**
 * Inserts demo vendors, a buyer and some products on a fresh database.
 */
function seed(PDO $pdo): void
{
    $hash = password_hash('password', PASSWORD_DEFAULT);

    $insUser = $pdo->prepare(
        'INSERT INTO users (name, email, password_hash, role, shop_name)
         VALUES (:name, :email, :hash, :role, :shop)'
    );

    $insUser->execute([
        ':name' => 'Alice Vendor', ':email' => 'alice@shop.test',
        ':hash' => $hash, ':role' => 'vendor', ':shop' => "Alice's Electronics",
    ]);
    $aliceId = (int) $pdo->lastInsertId();

    $insUser->execute([
        ':name' => 'Bob Vendor', ':email' => 'bob@shop.test',
        ':hash' => $hash, ':role' => 'vendor', ':shop' => "Bob's Books",
    ]);
    $bobId = (int) $pdo->lastInsertId();

    $insUser->execute([
        ':name' => 'Carol Buyer', ':email' => 'carol@shop.test',
        ':hash' => $hash, ':role' => 'buyer', ':shop' => null,
    ]);

    $insProduct = $pdo->prepare(
        'INSERT INTO products (vendor_id, name, description, price_cents, stock)
         VALUES (:vendor, :name, :desc, :price, :stock)'
    );

    $products = [
        [$aliceId, 'Wireless Headphones', 'Noise-cancelling over-ear headphones.', 12999, 25],
        [$aliceId, 'USB-C Charger 65W',   'Fast GaN charger for laptops & phones.', 3499, 60],
        [$aliceId, 'Mechanical Keyboard',  'Hot-swappable switches, RGB backlight.', 8999, 15],
        [$bobId,   'The Pragmatic Programmer', 'Classic software craftsmanship book.', 3999, 40],
        [$bobId,   'Clean Code',          'A handbook of agile software craftsmanship.', 3499, 30],
        [$bobId,   'Designing Data-Intensive Applications', 'The big ideas behind reliable systems.', 4599, 20],
    ];
    foreach ($products as [$vendor, $name, $desc, $price, $stock]) {
        $insProduct->execute([
            ':vendor' => $vendor, ':name' => $name, ':desc' => $desc,
            ':price' => $price, ':stock' => $stock,
        ]);
    }
}
