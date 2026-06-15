<?php
declare(strict_types=1);

/**
 * Database access via PDO. Supports SQLite (default) and MySQL.
 * All queries elsewhere use prepared statements with bound parameters.
 */
function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $driver = env('DB_DRIVER', 'sqlite');
    $options = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false, // real prepared statements
    ];

    if ($driver === 'mysql') {
        $dsn = sprintf(
            'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
            env('DB_HOST', '127.0.0.1'),
            env('DB_PORT', '3306'),
            env('DB_NAME', 'classifieds')
        );
        $pdo = new PDO($dsn, env('DB_USER', 'root'), env('DB_PASSWORD', ''), $options);
    } else {
        $path = env('DB_SQLITE_PATH', 'storage/classifieds.sqlite');
        if ($path !== ':memory:' && !preg_match('#^([A-Za-z]:[\\\\/]|/)#', $path)) {
            $path = BASE_PATH . '/' . $path;
        }
        if ($path !== ':memory:') {
            $dir = dirname($path);
            if (!is_dir($dir)) {
                mkdir($dir, 0775, true);
            }
        }
        $pdo = new PDO('sqlite:' . $path, null, null, $options);
        $pdo->exec('PRAGMA foreign_keys = ON');
    }

    migrate($pdo, $driver);
    return $pdo;
}

/**
 * Create tables if they do not exist and seed default categories.
 */
function migrate(PDO $pdo, string $driver): void
{
    $autoincrement = $driver === 'mysql'
        ? 'INT AUTO_INCREMENT PRIMARY KEY'
        : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    $now = $driver === 'mysql' ? 'CURRENT_TIMESTAMP' : "(datetime('now'))";

    $pdo->exec("CREATE TABLE IF NOT EXISTS users (
        id $autoincrement,
        email VARCHAR(255) NOT NULL UNIQUE,
        display_name VARCHAR(80) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT $now
    )");

    $pdo->exec("CREATE TABLE IF NOT EXISTS categories (
        id $autoincrement,
        slug VARCHAR(64) NOT NULL UNIQUE,
        name VARCHAR(64) NOT NULL
    )");

    $userFk = $driver === 'mysql'
        ? ', FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE'
        : ', FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE';

    $pdo->exec("CREATE TABLE IF NOT EXISTS listings (
        id $autoincrement,
        seller_id INTEGER NOT NULL,
        category_id INTEGER NOT NULL,
        title VARCHAR(140) NOT NULL,
        description TEXT NOT NULL,
        price_cents INTEGER NOT NULL,
        photo_path VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT $now,
        updated_at DATETIME NOT NULL DEFAULT $now
        $userFk
    )");

    // Seed categories once.
    $count = (int) $pdo->query('SELECT COUNT(*) AS c FROM categories')->fetch()['c'];
    if ($count === 0) {
        $cats = [
            ['electronics', 'Electronics'],
            ['vehicles', 'Vehicles'],
            ['furniture', 'Furniture'],
            ['clothing', 'Clothing'],
            ['home-garden', 'Home & Garden'],
            ['sports', 'Sports & Leisure'],
            ['books', 'Books & Media'],
            ['other', 'Other'],
        ];
        $stmt = $pdo->prepare('INSERT INTO categories (slug, name) VALUES (?, ?)');
        foreach ($cats as $c) {
            $stmt->execute($c);
        }
    }
}
