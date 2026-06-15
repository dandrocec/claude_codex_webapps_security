<?php

declare(strict_types=1);

namespace App;

use PDO;
use RuntimeException;

/**
 * Builds and shares a single PDO connection and creates the schema on first run.
 * Supports SQLite (default, zero-config) and MySQL via environment variables.
 */
final class Database
{
    private static ?PDO $pdo = null;

    public static function connection(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $driver = strtolower((string) Env::get('DB_DRIVER', 'sqlite'));

        $options = [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ];

        if ($driver === 'mysql') {
            $pdo = self::connectMysql($options);
        } else {
            $pdo = self::connectSqlite($options);
        }

        self::$pdo = $pdo;
        self::migrate($pdo, $driver);

        return $pdo;
    }

    /** @param array<int, mixed> $options */
    private static function connectSqlite(array $options): PDO
    {
        $path = (string) Env::get('DB_SQLITE_PATH', 'storage/database.sqlite');

        if (!self::isAbsolute($path)) {
            $path = dirname(__DIR__) . DIRECTORY_SEPARATOR . $path;
        }

        $dir = dirname($path);
        if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new RuntimeException('Unable to create database directory.');
        }

        $pdo = new PDO('sqlite:' . $path, null, null, $options);
        $pdo->exec('PRAGMA foreign_keys = ON');

        return $pdo;
    }

    /** @param array<int, mixed> $options */
    private static function connectMysql(array $options): PDO
    {
        $host = (string) Env::get('DB_HOST', '127.0.0.1');
        $port = (string) Env::get('DB_PORT', '3306');
        $name = (string) Env::get('DB_NAME', 'address_book');
        $user = (string) Env::get('DB_USER', 'root');
        $pass = (string) Env::get('DB_PASS', '');

        $dsn = sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $host, $port, $name);

        return new PDO($dsn, $user, $pass, $options);
    }

    private static function migrate(PDO $pdo, string $driver): void
    {
        if ($driver === 'mysql') {
            $pdo->exec(
                'CREATE TABLE IF NOT EXISTS users (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    email VARCHAR(255) NOT NULL UNIQUE,
                    password_hash VARCHAR(255) NOT NULL,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
            );

            $pdo->exec(
                'CREATE TABLE IF NOT EXISTS contacts (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    email VARCHAR(255) NOT NULL DEFAULT '',
                    phone VARCHAR(64) NOT NULL DEFAULT '',
                    address VARCHAR(1000) NOT NULL DEFAULT '',
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT fk_contacts_user FOREIGN KEY (user_id)
                        REFERENCES users (id) ON DELETE CASCADE,
                    INDEX idx_contacts_user (user_id),
                    INDEX idx_contacts_name (name)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
            );

            return;
        }

        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )'
        );

        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                email TEXT NOT NULL DEFAULT '',
                phone TEXT NOT NULL DEFAULT '',
                address TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )'
        );

        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts (user_id)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts (name)');
    }

    private static function isAbsolute(string $path): bool
    {
        return str_starts_with($path, '/')
            || (bool) preg_match('#^[A-Za-z]:[\\\\/]#', $path);
    }
}
