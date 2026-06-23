<?php

namespace App;

use PDO;

/**
 * Thin singleton wrapper around a PDO/SQLite connection.
 *
 * The schema is created on demand (CREATE TABLE IF NOT EXISTS) and a small set
 * of demo data is seeded the first time the database is empty, so the app is
 * runnable with no manual setup.
 */
class Database
{
    private static ?PDO $pdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo !== null) {
            return self::$pdo;
        }

        $dataDir = dirname(__DIR__) . '/data';
        if (!is_dir($dataDir)) {
            mkdir($dataDir, 0777, true);
        }

        $pdo = new PDO('sqlite:' . $dataDir . '/forum.sqlite');
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $pdo->exec('PRAGMA foreign_keys = ON');

        self::$pdo = $pdo;
        self::migrate();
        self::seed();

        return self::$pdo;
    }

    private static function migrate(): void
    {
        self::$pdo->exec(<<<SQL
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role          TEXT NOT NULL DEFAULT 'user',
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
                user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
                title      TEXT NOT NULL,
                body       TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS replies (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                thread_id  INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
                user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
                body       TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_threads_board ON threads(board_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_replies_thread ON replies(thread_id, created_at);
        SQL);
    }

    private static function seed(): void
    {
        $userCount = (int) self::$pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
        if ($userCount > 0) {
            return;
        }

        // Demo accounts. Passwords: see README.
        $insertUser = self::$pdo->prepare(
            'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
        );
        $insertUser->execute(['moderator', password_hash('moderator123', PASSWORD_DEFAULT), 'moderator']);
        $insertUser->execute(['alice', password_hash('alice123', PASSWORD_DEFAULT), 'user']);

        $boards = [
            ['General', 'Anything and everything.'],
            ['Announcements', 'News and updates from the team.'],
            ['Help & Support', 'Ask questions and get help.'],
        ];
        $insertBoard = self::$pdo->prepare('INSERT INTO boards (name, description) VALUES (?, ?)');
        foreach ($boards as [$name, $desc]) {
            $insertBoard->execute([$name, $desc]);
        }

        // One example thread so the home page isn't empty.
        self::$pdo->prepare(
            'INSERT INTO threads (board_id, user_id, title, body) VALUES (1, 2, ?, ?)'
        )->execute(['Welcome to the forum!', "This is an example thread. Register an account and start posting."]);
        self::$pdo->prepare(
            'INSERT INTO replies (thread_id, user_id, body) VALUES (1, 1, ?)'
        )->execute(['Glad to have you here. — the moderator']);
    }
}
