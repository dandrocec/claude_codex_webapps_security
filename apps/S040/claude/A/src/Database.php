<?php

declare(strict_types=1);

namespace App;

use PDO;

/**
 * Thin wrapper around a shared PDO connection to a SQLite database.
 *
 * The schema is created on demand (idempotent CREATE TABLE IF NOT EXISTS), and
 * a default set of categories is seeded the first time the database is created,
 * so the application is runnable immediately with no manual setup.
 */
final class Database
{
    private static ?PDO $pdo = null;

    public static function conn(): PDO
    {
        if (self::$pdo !== null) {
            return self::$pdo;
        }

        $dbPath = dirname(__DIR__) . '/data/app.sqlite';
        $dir = dirname($dbPath);
        if (!is_dir($dir)) {
            mkdir($dir, 0777, true);
        }

        $pdo = new PDO('sqlite:' . $dbPath);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $pdo->setAttribute(PDO::ATTR_EMULATE_PREPARES, false);
        $pdo->exec('PRAGMA foreign_keys = ON');

        self::$pdo = $pdo;
        self::migrate($pdo);

        return $pdo;
    }

    private static function migrate(PDO $pdo): void
    {
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT NOT NULL UNIQUE,
                email         TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at    TEXT NOT NULL DEFAULT (datetime(\'now\'))
            )'
        );

        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS categories (
                id   INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                slug TEXT NOT NULL UNIQUE
            )'
        );

        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS listings (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL,
                category_id INTEGER NOT NULL,
                title       TEXT NOT NULL,
                price       REAL NOT NULL DEFAULT 0,
                description TEXT NOT NULL DEFAULT \'\',
                photo       TEXT,
                created_at  TEXT NOT NULL DEFAULT (datetime(\'now\')),
                updated_at  TEXT NOT NULL DEFAULT (datetime(\'now\')),
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
                FOREIGN KEY (category_id) REFERENCES categories (id)
            )'
        );

        self::seedCategories($pdo);
    }

    private static function seedCategories(PDO $pdo): void
    {
        $count = (int) $pdo->query('SELECT COUNT(*) FROM categories')->fetchColumn();
        if ($count > 0) {
            return;
        }

        $categories = [
            'Electronics',
            'Vehicles',
            'Furniture',
            'Real Estate',
            'Fashion',
            'Sports & Leisure',
            'Books & Media',
            'Pets',
            'Home & Garden',
            'Other',
        ];

        $stmt = $pdo->prepare('INSERT INTO categories (name, slug) VALUES (:name, :slug)');
        foreach ($categories as $name) {
            $slug = preg_replace('/[^a-z0-9]+/', '-', strtolower($name));
            $stmt->execute(['name' => $name, 'slug' => trim($slug, '-')]);
        }
    }
}
