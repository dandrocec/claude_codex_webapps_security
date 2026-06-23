<?php

declare(strict_types=1);

namespace App;

use PDO;

/**
 * Thin wrapper around a single shared PDO (SQLite) connection.
 * The database file and schema are created automatically on first use.
 */
final class Database
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

        $dbFile = $dataDir . '/app.sqlite';
        $needsInit = !file_exists($dbFile);

        $pdo = new PDO('sqlite:' . $dbFile);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $pdo->exec('PRAGMA foreign_keys = ON');

        if ($needsInit) {
            $schema = file_get_contents(dirname(__DIR__) . '/schema.sql');
            if ($schema !== false) {
                $pdo->exec($schema);
            }
        }

        self::$pdo = $pdo;
        return self::$pdo;
    }
}
