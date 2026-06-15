<?php
declare(strict_types=1);

/**
 * Application bootstrap: session, database connection, schema setup and helpers.
 */

session_start();

const DATA_DIR = __DIR__ . '/../data';
const DB_FILE  = DATA_DIR . '/addressbook.sqlite';

/**
 * Return a shared PDO connection, creating the schema on first run.
 */
function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    if (!is_dir(DATA_DIR)) {
        mkdir(DATA_DIR, 0775, true);
    }

    $pdo = new PDO('sqlite:' . DB_FILE);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA foreign_keys = ON');

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )'
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS contacts (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL,
            name       TEXT NOT NULL,
            email      TEXT NOT NULL DEFAULT "",
            phone      TEXT NOT NULL DEFAULT "",
            address    TEXT NOT NULL DEFAULT "",
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )'
    );

    return $pdo;
}

/** Escape a string for safe HTML output. */
function e(?string $value): string
{
    return htmlspecialchars($value ?? '', ENT_QUOTES, 'UTF-8');
}

/** Send a redirect to the given path and stop execution. */
function redirect(string $path): void
{
    header('Location: ' . $path);
    exit;
}

/** The currently logged-in user row, or null. */
function current_user(): ?array
{
    if (empty($_SESSION['user_id'])) {
        return null;
    }
    static $user = null;
    if ($user === null) {
        $stmt = db()->prepare('SELECT id, username FROM users WHERE id = ?');
        $stmt->execute([$_SESSION['user_id']]);
        $user = $stmt->fetch() ?: null;
    }
    return $user;
}

/** Require an authenticated user; redirect to login otherwise. */
function require_login(): array
{
    $user = current_user();
    if (!$user) {
        redirect('/login');
    }
    return $user;
}

/** Get (and lazily create) the CSRF token for this session. */
function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

/** Verify a submitted CSRF token; abort with 400 on mismatch. */
function csrf_check(): void
{
    $token = $_POST['csrf'] ?? '';
    if (!hash_equals($_SESSION['csrf'] ?? '', $token)) {
        http_response_code(400);
        exit('Invalid CSRF token.');
    }
}

/** Store a one-time flash message. */
function flash(?string $message = null): ?string
{
    if ($message !== null) {
        $_SESSION['flash'] = $message;
        return null;
    }
    $msg = $_SESSION['flash'] ?? null;
    unset($_SESSION['flash']);
    return $msg;
}

/** Render a view inside the shared layout. */
function render(string $view, array $data = []): void
{
    extract($data, EXTR_SKIP);
    $viewFile = __DIR__ . '/../views/' . $view . '.php';
    ob_start();
    require $viewFile;
    $content = ob_get_clean();
    require __DIR__ . '/../views/layout.php';
}
