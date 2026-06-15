<?php

declare(strict_types=1);

namespace App;

use PDO;
use PDOException;

/**
 * Thin wrapper around a PDO/SQLite connection. All queries elsewhere use
 * prepared statements with bound parameters to prevent SQL injection.
 */
final class Database
{
    private static ?PDO $pdo = null;

    public static function connection(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $path = env('DB_PATH', 'data/guestbook.sqlite');

        // Resolve relative paths against the project root.
        if (!self::isAbsolute($path)) {
            $path = dirname(__DIR__) . '/' . ltrim($path, '/\\');
        }

        $dir = dirname($path);
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }

        $pdo = new PDO('sqlite:' . $path, null, null, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);

        $pdo->exec('PRAGMA foreign_keys = ON');
        $pdo->exec('PRAGMA journal_mode = WAL');

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
                password_hash TEXT NOT NULL,
                is_admin      INTEGER NOT NULL DEFAULT 0,
                created_at    TEXT NOT NULL DEFAULT (datetime(\'now\'))
            )'
        );

        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS messages (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER,
                author_name TEXT NOT NULL,
                body        TEXT NOT NULL,
                created_at  TEXT NOT NULL DEFAULT (datetime(\'now\')),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
            )'
        );

        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC)');
    }

    private static function isAbsolute(string $path): bool
    {
        return $path !== ''
            && ($path[0] === '/' || $path[0] === '\\' || preg_match('#^[A-Za-z]:[\\\\/]#', $path) === 1);
    }
}
