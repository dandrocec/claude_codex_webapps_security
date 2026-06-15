<?php
/**
 * Database bootstrap.
 *
 * Uses SQLite via PDO so the app runs with no separate database server.
 * The database file is created automatically on first run and the
 * `messages` table is ensured to exist.
 */

declare(strict_types=1);

function get_db(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $dbFile = __DIR__ . '/data/guestbook.sqlite';

    // Make sure the data directory exists.
    $dir = dirname($dbFile);
    if (!is_dir($dir)) {
        mkdir($dir, 0777, true);
    }

    $pdo = new PDO('sqlite:' . $dbFile);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS messages (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            message    TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime(\'now\'))
        )'
    );

    return $pdo;
}
