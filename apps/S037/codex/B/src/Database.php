<?php

declare(strict_types=1);

namespace Gallery;

use PDO;

final class Database
{
    public static function connect(): PDO
    {
        $defaultPath = dirname(__DIR__) . '/data/gallery.sqlite';
        $dsn = getenv('DB_DSN') ?: 'sqlite:' . $defaultPath;
        if (str_starts_with($dsn, 'sqlite:')) {
            $path = substr($dsn, 7);
            if ($path !== ':memory:') {
                $dir = dirname($path);
                if (!is_dir($dir)) {
                    mkdir($dir, 0700, true);
                }
            }
        }

        $pdo = new PDO($dsn, getenv('DB_USER') ?: null, getenv('DB_PASS') ?: null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        $pdo->exec('PRAGMA foreign_keys = ON');
        return $pdo;
    }

    public static function migrate(PDO $pdo): void
    {
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            )'
        );
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS images (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                public_id TEXT NOT NULL UNIQUE,
                caption TEXT NOT NULL,
                filename TEXT NOT NULL,
                thumb_filename TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )'
        );
    }
}
