<?php

declare(strict_types=1);

function db(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $path = database_path();
    $directory = dirname($path);
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('Could not create storage directory.');
    }

    $pdo = new PDO('sqlite:' . $path, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON');

    return $pdo;
}

function initialize_database(): void
{
    db()->exec(
        'CREATE TABLE IF NOT EXISTS subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id TEXT NOT NULL DEFAULT ''admin'',
            email TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )'
    );

    db()->exec(
        'CREATE TABLE IF NOT EXISTS admin_users (
            id TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )'
    );

    upsert_admin_user('admin', admin_password());
}

function upsert_admin_user(string $adminId, string $password): void
{
    $pepperedPassword = hash_hmac('sha256', $password, app_secret());
    $passwordHash = password_hash($pepperedPassword, PASSWORD_ARGON2ID);

    $statement = db()->prepare(
        'INSERT INTO admin_users (id, password_hash, updated_at)
         VALUES (:id, :password_hash, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
            password_hash = excluded.password_hash,
            updated_at = CURRENT_TIMESTAMP'
    );
    $statement->execute([
        ':id' => $adminId,
        ':password_hash' => $passwordHash,
    ]);
}

function admin_password_hash_from_database(string $adminId): ?string
{
    $statement = db()->prepare('SELECT password_hash FROM admin_users WHERE id = :id');
    $statement->execute([':id' => $adminId]);
    $hash = $statement->fetchColumn();

    return is_string($hash) ? $hash : null;
}

function subscribe_email(string $email): void
{
    $statement = db()->prepare(
        'INSERT INTO subscriptions (owner_id, email)
         VALUES (:owner_id, :email)
         ON CONFLICT(email) DO UPDATE SET email = excluded.email'
    );
    $statement->execute([
        ':owner_id' => 'admin',
        ':email' => $email,
    ]);
}

function list_subscribers_for_admin(string $adminId): array
{
    if (!is_admin_authenticated() || $adminId !== 'admin') {
        http_response_code(403);
        render_error_page('Access denied.');
    }

    $statement = db()->prepare(
        'SELECT email, created_at
         FROM subscriptions
         WHERE owner_id = :owner_id
         ORDER BY created_at DESC, email ASC'
    );
    $statement->execute([':owner_id' => $adminId]);

    return $statement->fetchAll();
}
