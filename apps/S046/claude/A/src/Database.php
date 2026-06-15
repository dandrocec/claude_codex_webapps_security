<?php

declare(strict_types=1);

namespace App;

use PDO;

/**
 * Thin wrapper around a PDO/SQLite connection.
 *
 * The database file lives in /data and is created automatically on first run,
 * along with its schema and a couple of seed accounts.
 */
final class Database
{
    private static ?PDO $pdo = null;

    public static function connection(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $dataDir = dirname(__DIR__) . '/data';
        if (!is_dir($dataDir)) {
            mkdir($dataDir, 0775, true);
        }

        $file = $dataDir . '/quotes.sqlite';
        $isNew = !file_exists($file);

        $pdo = new PDO('sqlite:' . $file);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $pdo->exec('PRAGMA foreign_keys = ON');

        self::$pdo = $pdo;

        if ($isNew) {
            self::migrate();
            self::seed();
        }

        return self::$pdo;
    }

    private static function migrate(): void
    {
        $sql = file_get_contents(dirname(__DIR__) . '/schema.sql');
        self::$pdo->exec($sql);
    }

    private static function seed(): void
    {
        $pdo = self::$pdo;

        // Two demo accounts so the app is usable immediately.
        // One is an admin (can approve quotes), one is a regular submitter.
        $users = [
            ['admin', 'admin@example.com', 'admin123', 1],
            ['alice', 'alice@example.com', 'alice123', 0],
        ];

        $stmt = $pdo->prepare(
            'INSERT INTO users (username, email, password_hash, is_admin)
             VALUES (:u, :e, :p, :a)'
        );

        foreach ($users as [$username, $email, $password, $isAdmin]) {
            $stmt->execute([
                ':u' => $username,
                ':e' => $email,
                ':p' => password_hash($password, PASSWORD_DEFAULT),
                ':a' => $isAdmin,
            ]);
        }

        // A few approved quotes so the public page isn't empty on first visit.
        $aliceId = (int) $pdo->query("SELECT id FROM users WHERE username = 'alice'")->fetchColumn();

        $quotes = [
            ['The only way to do great work is to love what you do.', 'Steve Jobs'],
            ['Simplicity is the ultimate sophistication.', 'Leonardo da Vinci'],
            ['Premature optimization is the root of all evil.', 'Donald Knuth'],
        ];

        $stmt = $pdo->prepare(
            'INSERT INTO quotes (user_id, text, author, approved)
             VALUES (:uid, :text, :author, 1)'
        );

        foreach ($quotes as [$text, $author]) {
            $stmt->execute([
                ':uid' => $aliceId,
                ':text' => $text,
                ':author' => $author,
            ]);
        }
    }
}
