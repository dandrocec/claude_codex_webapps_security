<?php
/**
 * Database bootstrap. Returns a shared PDO connection to a SQLite database
 * and ensures the subscribers table exists.
 */

declare(strict_types=1);

function get_db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }

    $dataDir = __DIR__ . '/../data';
    if (!is_dir($dataDir)) {
        mkdir($dataDir, 0777, true);
    }

    $pdo = new PDO('sqlite:' . $dataDir . '/subscribers.sqlite');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS subscribers (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
            created_at TEXT NOT NULL DEFAULT (datetime(\'now\'))
        )'
    );

    return $pdo;
}
