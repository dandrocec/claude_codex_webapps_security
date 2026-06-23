<?php

declare(strict_types=1);

namespace App;

/**
 * Session-based authentication for agents.
 */
final class Auth
{
    /** Register a new agent. Returns the new id, or null if the email is taken. */
    public static function register(string $name, string $email, string $phone, string $password): ?int
    {
        $pdo = Database::pdo();

        $exists = $pdo->prepare('SELECT 1 FROM agents WHERE email = ?');
        $exists->execute([$email]);
        if ($exists->fetchColumn()) {
            return null;
        }

        $stmt = $pdo->prepare(
            'INSERT INTO agents (name, email, phone, password_hash) VALUES (?, ?, ?, ?)'
        );
        $stmt->execute([
            $name,
            $email,
            $phone,
            password_hash($password, PASSWORD_DEFAULT),
        ]);

        return (int) $pdo->lastInsertId();
    }

    /** Verify credentials and start a session. Returns true on success. */
    public static function attempt(string $email, string $password): bool
    {
        $stmt = Database::pdo()->prepare('SELECT * FROM agents WHERE email = ?');
        $stmt->execute([$email]);
        $agent = $stmt->fetch();

        if ($agent && password_verify($password, $agent['password_hash'])) {
            $_SESSION['agent_id'] = (int) $agent['id'];
            $_SESSION['agent_name'] = $agent['name'];
            return true;
        }
        return false;
    }

    public static function logout(): void
    {
        unset($_SESSION['agent_id'], $_SESSION['agent_name']);
    }

    public static function check(): bool
    {
        return isset($_SESSION['agent_id']);
    }

    public static function id(): ?int
    {
        return isset($_SESSION['agent_id']) ? (int) $_SESSION['agent_id'] : null;
    }

    public static function name(): ?string
    {
        return $_SESSION['agent_name'] ?? null;
    }

    /** Redirect to the login page when not authenticated. */
    public static function requireLogin(): void
    {
        if (!self::check()) {
            Helpers::flash('Please log in to manage your listings.');
            Helpers::redirect('/login');
        }
    }
}
