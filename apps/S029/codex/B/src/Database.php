<?php

declare(strict_types=1);

namespace Guestbook;

use PDO;

final class Database
{
    public static function connection(): PDO
    {
        $path = App::env('DB_PATH', dirname(__DIR__) . '/storage/guestbook.sqlite');
        if ($path === null || $path === '') {
            throw new \RuntimeException('DB_PATH is not configured.');
        }

        if (!str_starts_with($path, DIRECTORY_SEPARATOR) && !preg_match('/^[A-Za-z]:[\\\\\/]/', $path)) {
            $path = dirname(__DIR__) . DIRECTORY_SEPARATOR . $path;
        }

        $directory = dirname($path);
        if (!is_dir($directory) && !mkdir($directory, 0750, true) && !is_dir($directory)) {
            throw new \RuntimeException('Database directory could not be created.');
        }

        $pdo = new PDO('sqlite:' . $path, null, null, [
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);

        self::migrate($pdo);
        return $pdo;
    }

    private static function migrate(PDO $pdo): void
    {
        $pdo->exec('PRAGMA foreign_keys = ON');
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            )'
        );
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                display_name TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )'
        );
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC)');
    }
}
