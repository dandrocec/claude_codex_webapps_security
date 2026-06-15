<?php

declare(strict_types=1);

namespace App;

use PDO;
use RuntimeException;

/**
 * Thin wrapper around a PDO/SQLite connection.
 *
 * All queries elsewhere in the app go through prepared statements, so this
 * class only owns connection setup and the one-time schema bootstrap.
 */
final class Database
{
    private static ?PDO $pdo = null;

    public static function connection(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $path = config('DB_PATH', dirname(__DIR__) . '/storage/database.sqlite');

        // Ensure the parent directory exists (e.g. on a fresh checkout).
        $dir = dirname($path);
        if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new RuntimeException('Unable to create database directory.');
        }

        $pdo = new PDO('sqlite:' . $path, null, null, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);

        // Enforce foreign keys and use a safer journaling mode.
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
                username      TEXT    NOT NULL UNIQUE,
                password_hash TEXT    NOT NULL,
                created_at    TEXT    NOT NULL DEFAULT (datetime(\'now\'))
            )'
        );

        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS images (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id        INTEGER NOT NULL,
                stored_name    TEXT    NOT NULL UNIQUE,
                thumb_name     TEXT    NOT NULL,
                mime           TEXT    NOT NULL,
                caption        TEXT    NOT NULL DEFAULT \'\',
                created_at     TEXT    NOT NULL DEFAULT (datetime(\'now\')),
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )'
        );
    }
}
