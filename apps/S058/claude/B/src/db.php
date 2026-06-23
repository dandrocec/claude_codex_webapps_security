<?php
declare(strict_types=1);

/**
 * Database connection (PDO/SQLite) plus schema migration & seeding.
 *
 * All queries in this app use prepared statements with bound parameters,
 * which prevents SQL injection.
 */

if (!function_exists('db')) {
    function db(): PDO
    {
        static $pdo = null;
        if ($pdo instanceof PDO) {
            return $pdo;
        }

        $cfg = config();
        $path = $cfg['db_path'];
        $dir = dirname($path);
        if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) {
            throw new RuntimeException('Unable to create data directory.');
        }

        $pdo = new PDO('sqlite:' . $path, null, null, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
        $pdo->exec('PRAGMA foreign_keys = ON');
        $pdo->exec('PRAGMA journal_mode = WAL');

        migrate($pdo);

        return $pdo;
    }
}

if (!function_exists('migrate')) {
    function migrate(PDO $pdo): void
    {
        $pdo->exec(<<<SQL
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role          TEXT NOT NULL DEFAULT 'user'
                              CHECK (role IN ('user','moderator')),
                created_at    TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS boards (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT NOT NULL UNIQUE,
                description TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS threads (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                board_id   INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title      TEXT NOT NULL,
                body       TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS replies (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                thread_id  INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                body       TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_threads_board   ON threads(board_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_replies_thread  ON replies(thread_id, created_at);
        SQL);

        seed($pdo);
    }
}

if (!function_exists('seed')) {
    function seed(PDO $pdo): void
    {
        $count = (int) $pdo->query('SELECT COUNT(*) FROM boards')->fetchColumn();
        if ($count > 0) {
            return;
        }
        $boards = [
            ['General Discussion', 'Talk about anything and everything.'],
            ['Announcements',       'Official news and updates.'],
            ['Help & Support',      'Ask questions and get help from the community.'],
        ];
        $stmt = $pdo->prepare('INSERT INTO boards (name, description) VALUES (:name, :description)');
        foreach ($boards as [$name, $description]) {
            $stmt->execute([':name' => $name, ':description' => $description]);
        }
    }
}
