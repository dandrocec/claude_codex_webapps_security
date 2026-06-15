<?php
declare(strict_types=1);

/**
 * Shared bootstrap: session, filesystem paths, database, and small helpers.
 * Included by every page in public/.
 */

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

define('BASE_DIR', dirname(__DIR__));
define('DATA_DIR', BASE_DIR . '/data');
define('UPLOAD_DIR', BASE_DIR . '/public/uploads');
define('THUMB_DIR', UPLOAD_DIR . '/thumbs');

// Public URL prefixes (relative to the docroot in public/).
define('UPLOAD_URL', 'uploads');
define('THUMB_URL', 'uploads/thumbs');

foreach ([DATA_DIR, UPLOAD_DIR, THUMB_DIR] as $dir) {
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
}

/**
 * Return a shared PDO connection, creating the schema and a default user
 * on first run.
 */
function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $pdo = new PDO('sqlite:' . DATA_DIR . '/gallery.sqlite');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA foreign_keys = ON');

    $pdo->exec('
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at    TEXT NOT NULL DEFAULT (datetime("now"))
        )
    ');

    $pdo->exec('
        CREATE TABLE IF NOT EXISTS images (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            caption        TEXT NOT NULL DEFAULT "",
            filename       TEXT NOT NULL,
            thumb_filename TEXT NOT NULL,
            original_name  TEXT NOT NULL,
            created_at     TEXT NOT NULL DEFAULT (datetime("now"))
        )
    ');

    // Seed a default account so the app is usable immediately.
    $count = (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
    if ($count === 0) {
        $stmt = $pdo->prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
        $stmt->execute(['admin', password_hash('admin123', PASSWORD_DEFAULT)]);
    }

    return $pdo;
}

/** HTML-escape a string for safe output. */
function e(?string $value): string
{
    return htmlspecialchars($value ?? '', ENT_QUOTES, 'UTF-8');
}

/** The currently logged-in user row, or null. */
function current_user(): ?array
{
    if (empty($_SESSION['user_id'])) {
        return null;
    }
    $stmt = db()->prepare('SELECT id, username FROM users WHERE id = ?');
    $stmt->execute([$_SESSION['user_id']]);
    $user = $stmt->fetch();
    return $user ?: null;
}

/** Redirect to /login.php unless someone is logged in. */
function require_login(): array
{
    $user = current_user();
    if ($user === null) {
        header('Location: login.php');
        exit;
    }
    return $user;
}

/** Return (and lazily create) the per-session CSRF token. */
function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

/** Validate a submitted CSRF token; abort the request if it is wrong. */
function check_csrf(): void
{
    $sent = $_POST['csrf'] ?? '';
    if (!is_string($sent) || !hash_equals($_SESSION['csrf'] ?? '', $sent)) {
        http_response_code(400);
        exit('Invalid CSRF token. Please go back and try again.');
    }
}
