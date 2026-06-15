<?php

declare(strict_types=1);

namespace App;

use PDO;

/**
 * Thin wrapper around a shared PDO (SQLite) connection.
 *
 * The schema is created on first connection, so the app is runnable with no
 * manual migration step — just start the server and go.
 */
final class Database
{
    private static ?PDO $pdo = null;

    public static function connection(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $dir = dirname(__DIR__) . '/data';
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }

        $pdo = new PDO('sqlite:' . $dir . '/blog.sqlite');
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
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
                username      TEXT    NOT NULL UNIQUE,
                password_hash TEXT    NOT NULL,
                created_at    TEXT    NOT NULL DEFAULT (datetime(\'now\'))
            )'
        );

        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS posts (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL,
                image_path TEXT    NOT NULL,
                caption    TEXT    NOT NULL DEFAULT \'\',
                created_at TEXT    NOT NULL DEFAULT (datetime(\'now\')),
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )'
        );
    }
}
