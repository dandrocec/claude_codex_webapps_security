<?php
declare(strict_types=1);

/**
 * Database access (SQLite via PDO) and schema bootstrapping.
 * All queries in the app use prepared statements with bound parameters.
 */

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $dir = dirname(DB_PATH);
    if (!is_dir($dir)) {
        mkdir($dir, 0750, true);
    }

    $pdo = new PDO('sqlite:' . DB_PATH, null, null, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA journal_mode = WAL');

    migrate($pdo);
    return $pdo;
}

function migrate(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at    TEXT NOT NULL DEFAULT (datetime(\'now\'))
        )'
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS posts (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL,
            image_name TEXT NOT NULL,
            mime_type  TEXT NOT NULL,
            caption    TEXT NOT NULL DEFAULT \'\',
            created_at TEXT NOT NULL DEFAULT (datetime(\'now\')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )'
    );

    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (created_at DESC)');
}
