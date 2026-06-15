<?php
declare(strict_types=1);

namespace App;

use PDO;

/**
 * Thin PDO wrapper. All queries elsewhere use prepared statements with
 * bound parameters to prevent SQL injection.
 */
final class Database
{
    private static ?PDO $pdo = null;

    public static function connection(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $dsn = Env::get('DB_DSN', 'sqlite:' . APP_ROOT . '/data/quotes.sqlite');

        // For SQLite, resolve a relative path against the project root and
        // ensure the containing directory exists.
        if (str_starts_with((string) $dsn, 'sqlite:')) {
            $path = substr((string) $dsn, strlen('sqlite:'));
            if ($path !== '' && $path !== ':memory:' && !self::isAbsolute($path)) {
                $path = APP_ROOT . '/' . ltrim($path, '/\\');
            }
            if ($path !== ':memory:') {
                $dir = dirname($path);
                if (!is_dir($dir)) {
                    @mkdir($dir, 0775, true);
                }
            }
            $dsn = 'sqlite:' . $path;
        }

        $user = Env::get('DB_USER');
        $pass = Env::get('DB_PASS');

        $pdo = new PDO((string) $dsn, $user, $pass, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false, // real prepared statements
        ]);

        if (str_starts_with((string) $dsn, 'sqlite:')) {
            $pdo->exec('PRAGMA foreign_keys = ON');
        }

        return self::$pdo = $pdo;
    }

    private static function isAbsolute(string $path): bool
    {
        return $path[0] === '/'
            || (strlen($path) > 1 && ctype_alpha($path[0]) && $path[1] === ':'); // Windows C:\
    }
}
