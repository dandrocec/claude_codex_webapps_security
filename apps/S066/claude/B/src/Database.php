<?php

declare(strict_types=1);

namespace App;

use PDO;
use PDOException;

/**
 * Thin PDO wrapper around SQLite. Every query in the app uses prepared,
 * parameterised statements (see callers) to prevent SQL injection.
 */
final class Database
{
    private static ?PDO $pdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $path = Config::dbPath();
        $dir = \dirname($path);
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }

        try {
            $pdo = new PDO('sqlite:' . $path, null, null, [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]);
        } catch (PDOException $e) {
            // Never surface the raw driver message to the client.
            throw new \RuntimeException('Database connection failed.', 0, $e);
        }

        $pdo->exec('PRAGMA foreign_keys = ON');
        $pdo->exec('PRAGMA journal_mode = WAL');

        self::$pdo = $pdo;
        self::migrate($pdo);

        return $pdo;
    }

    private static function migrate(PDO $pdo): void
    {
        $pdo->exec(<<<'SQL'
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                name          TEXT    NOT NULL,
                email         TEXT    NOT NULL UNIQUE,
                password_hash TEXT    NOT NULL,
                role          TEXT    NOT NULL DEFAULT 'agent',
                created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
            )
        SQL);

        $pdo->exec(<<<'SQL'
            CREATE TABLE IF NOT EXISTS listings (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title       TEXT    NOT NULL,
                description TEXT    NOT NULL DEFAULT '',
                price       INTEGER NOT NULL,
                location    TEXT    NOT NULL,
                bedrooms    INTEGER NOT NULL DEFAULT 0,
                bathrooms   INTEGER NOT NULL DEFAULT 0,
                area_sqm    INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
                updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
            )
        SQL);

        $pdo->exec(<<<'SQL'
            CREATE TABLE IF NOT EXISTS photos (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
                filename   TEXT    NOT NULL,
                mime       TEXT    NOT NULL,
                created_at TEXT    NOT NULL DEFAULT (datetime('now'))
            )
        SQL);

        $pdo->exec(<<<'SQL'
            CREATE TABLE IF NOT EXISTS inquiries (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                listing_id   INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
                agent_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                sender_name  TEXT    NOT NULL,
                sender_email TEXT    NOT NULL,
                body         TEXT    NOT NULL,
                created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
            )
        SQL);

        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_listings_agent ON listings(agent_id)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_photos_listing ON photos(listing_id)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_inquiries_agent ON inquiries(agent_id)');
    }
}
