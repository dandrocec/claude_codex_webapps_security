<?php

declare(strict_types=1);

namespace App;

use PDO;

final class Database
{
    public static function connect(string $root): PDO
    {
        $dsn = $_ENV['DB_DSN'] ?? 'sqlite:storage/classifieds.sqlite';
        if (str_starts_with($dsn, 'sqlite:') && !str_starts_with($dsn, 'sqlite:/')) {
            $path = substr($dsn, 7);
            $dir = dirname($root . '/' . $path);
            if (!is_dir($dir)) {
                mkdir($dir, 0750, true);
            }
            $dsn = 'sqlite:' . $root . '/' . $path;
        }

        $pdo = new PDO($dsn, $_ENV['DB_USER'] ?? null, $_ENV['DB_PASS'] ?? null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        if (str_starts_with($dsn, 'sqlite:')) {
            $pdo->exec('PRAGMA foreign_keys = ON');
        }
        return $pdo;
    }
}
