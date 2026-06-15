<?php
declare(strict_types=1);

namespace App;

use PDO;

/**
 * Authentication: registration, login, logout and the current user.
 * Passwords are hashed with PHP's password_hash() (bcrypt/Argon2 — strong,
 * salted, adaptive). Plaintext passwords are never stored or logged.
 */
final class Auth
{
    public static function user(): ?array
    {
        $id = $_SESSION['user_id'] ?? null;
        if (!is_int($id)) {
            return null;
        }
        $stmt = Database::connection()->prepare(
            'SELECT id, username, is_admin, created_at FROM users WHERE id = :id'
        );
        $stmt->execute([':id' => $id]);
        $user = $stmt->fetch();
        return $user ?: null;
    }

    public static function check(): bool
    {
        return isset($_SESSION['user_id']);
    }

    public static function isAdmin(): bool
    {
        $user = self::user();
        return $user !== null && (int) $user['is_admin'] === 1;
    }

    public static function requireAdmin(): array
    {
        $user = self::requireLogin();
        if ((int) $user['is_admin'] !== 1) {
            http_response_code(403);
            view('errors/404', ['title' => 'Forbidden']);
            exit;
        }
        return $user;
    }

    public static function requireLogin(): array
    {
        $user = self::user();
        if ($user === null) {
            flash('error', 'Please sign in to continue.');
            redirect('/login');
        }
        return $user;
    }

    /**
     * @return array{0:bool,1:?string} success flag and an error message
     */
    public static function register(string $username, string $password): array
    {
        $username = trim($username);

        if ($username === '' || mb_strlen($username) < 3 || mb_strlen($username) > 50) {
            return [false, 'Username must be between 3 and 50 characters.'];
        }
        if (!preg_match('/^[A-Za-z0-9_.-]+$/', $username)) {
            return [false, 'Username may contain only letters, numbers and _ . - characters.'];
        }
        if (strlen($password) < 8 || strlen($password) > 200) {
            return [false, 'Password must be at least 8 characters.'];
        }

        $pdo = Database::connection();
        $stmt = $pdo->prepare('SELECT 1 FROM users WHERE username = :u');
        $stmt->execute([':u' => $username]);
        if ($stmt->fetchColumn() !== false) {
            return [false, 'That username is already taken.'];
        }

        $hash = password_hash($password, PASSWORD_DEFAULT);
        $stmt = $pdo->prepare(
            'INSERT INTO users (username, password_hash, created_at) VALUES (:u, :h, :t)'
        );
        $stmt->execute([
            ':u' => $username,
            ':h' => $hash,
            ':t' => gmdate('Y-m-d H:i:s'),
        ]);

        return [true, null];
    }

    public static function attempt(string $username, string $password): bool
    {
        $stmt = Database::connection()->prepare(
            'SELECT id, password_hash FROM users WHERE username = :u'
        );
        $stmt->execute([':u' => trim($username)]);
        $row = $stmt->fetch();

        // Always run a hash verification to reduce username-enumeration timing.
        $hash = is_array($row) ? (string) $row['password_hash'] : '$2y$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
        $ok = password_verify($password, $hash);

        if (!$ok || !is_array($row)) {
            return false;
        }

        // Transparently upgrade the hash if the algorithm/cost changed.
        if (password_needs_rehash($hash, PASSWORD_DEFAULT)) {
            $new = password_hash($password, PASSWORD_DEFAULT);
            $upd = Database::connection()->prepare('UPDATE users SET password_hash = :h WHERE id = :id');
            $upd->execute([':h' => $new, ':id' => (int) $row['id']]);
        }

        // Prevent session fixation on privilege change.
        session_regenerate_id(true);
        $_SESSION['user_id'] = (int) $row['id'];
        return true;
    }

    public static function logout(): void
    {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(
                session_name(),
                '',
                [
                    'expires'  => time() - 42000,
                    'path'     => $params['path'],
                    'domain'   => $params['domain'],
                    'secure'   => $params['secure'],
                    'httponly' => $params['httponly'],
                    'samesite' => $params['samesite'],
                ]
            );
        }
        session_destroy();
    }
}
