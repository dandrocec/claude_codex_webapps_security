<?php

declare(strict_types=1);

/**
 * Returns a shared PDO connection to the SQLite database, creating the schema
 * on first use. Errors are thrown as exceptions (handled centrally), never
 * echoed to the client.
 */
function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $path = env('DATABASE_PATH', 'data/app.sqlite');

    // Resolve relative paths against the project root.
    if (!preg_match('#^([a-zA-Z]:[\\\\/]|/)#', $path)) {
        $path = dirname(__DIR__) . DIRECTORY_SEPARATOR . $path;
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

    $pdo->exec('PRAGMA journal_mode = WAL;');
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS subscribers (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            email      TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL DEFAULT (datetime(\'now\'))
        )'
    );

    return $pdo;
}
