<?php

declare(strict_types=1);

namespace App;

use PDO;

/**
 * PDO wrapper. All queries in the app go through prepared statements, which is
 * the primary defence against SQL injection (OWASP A03).
 */
final class Database
{
    private static ?PDO $pdo = null;

    public static function connection(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $path = Env::get('DB_PATH', 'storage/marketplace.sqlite') ?? 'storage/marketplace.sqlite';
        if (!self::isAbsolute($path)) {
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
        // Enforce foreign key constraints (off by default in SQLite).
        $pdo->exec('PRAGMA foreign_keys = ON');
        $pdo->exec('PRAGMA journal_mode = WAL');

        self::$pdo = $pdo;
        return $pdo;
    }

    private static function isAbsolute(string $path): bool
    {
        return $path !== ''
            && ($path[0] === '/' || $path[0] === '\\' || preg_match('/^[A-Za-z]:[\\\\\\/]/', $path) === 1);
    }
}
