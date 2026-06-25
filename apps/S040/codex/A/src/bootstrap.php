<?php

declare(strict_types=1);

session_start();

const BASE_PATH = __DIR__ . '/..';
const DB_PATH = BASE_PATH . '/database/classifieds.sqlite';
const UPLOAD_PATH = BASE_PATH . '/public/uploads';
const UPLOAD_URL = '/uploads';

if (!is_dir(BASE_PATH . '/database')) {
    mkdir(BASE_PATH . '/database', 0775, true);
}

if (!is_dir(UPLOAD_PATH)) {
    mkdir(UPLOAD_PATH, 0775, true);
}

$pdo = new PDO('sqlite:' . DB_PATH);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

$pdo->exec(
    'CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )'
);

$pdo->exec(
    'CREATE TABLE IF NOT EXISTS listings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        price INTEGER NOT NULL,
        description TEXT NOT NULL,
        photo_path TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )'
);

$pdo->exec('CREATE INDEX IF NOT EXISTS idx_listings_category ON listings(category)');
$pdo->exec('CREATE INDEX IF NOT EXISTS idx_listings_search ON listings(title, description)');

function db(): PDO
{
    global $pdo;
    return $pdo;
}

function current_user(): ?array
{
    if (empty($_SESSION['user_id'])) {
        return null;
    }

    $stmt = db()->prepare('SELECT id, name, email FROM users WHERE id = ?');
    $stmt->execute([$_SESSION['user_id']]);
    $user = $stmt->fetch();

    return $user ?: null;
}

function require_login(): array
{
    $user = current_user();
    if (!$user) {
        flash('Please log in to continue.');
        redirect('/login');
    }

    return $user;
}

function categories(): array
{
    return ['Electronics', 'Home', 'Vehicles', 'Fashion', 'Sports', 'Books', 'Services', 'Other'];
}

function e(?string $value): string
{
    return htmlspecialchars($value ?? '', ENT_QUOTES, 'UTF-8');
}

function money(int $cents): string
{
    return '$' . number_format($cents / 100, 2);
}

function price_to_cents(string $price): int
{
    $normalized = preg_replace('/[^0-9.]/', '', $price);
    if ($normalized === '' || !is_numeric($normalized)) {
        return 0;
    }

    return (int) round(((float) $normalized) * 100);
}

function redirect(string $path): never
{
    header('Location: ' . $path);
    exit;
}

function flash(?string $message = null): ?string
{
    if ($message !== null) {
        $_SESSION['flash'] = $message;
        return null;
    }

    $message = $_SESSION['flash'] ?? null;
    unset($_SESSION['flash']);

    return $message;
}

function old(array $source, string $key, string $default = ''): string
{
    return isset($source[$key]) ? (string) $source[$key] : $default;
}

function handle_photo_upload(?string $existingPath = null): ?string
{
    if (empty($_FILES['photo']) || $_FILES['photo']['error'] === UPLOAD_ERR_NO_FILE) {
        return $existingPath;
    }

    if ($_FILES['photo']['error'] !== UPLOAD_ERR_OK) {
        throw new RuntimeException('Photo upload failed.');
    }

    if ($_FILES['photo']['size'] > 3 * 1024 * 1024) {
        throw new RuntimeException('Photo must be smaller than 3 MB.');
    }

    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime = $finfo->file($_FILES['photo']['tmp_name']);
    $extensions = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
        'image/gif' => 'gif',
    ];

    if (!isset($extensions[$mime])) {
        throw new RuntimeException('Photo must be a JPG, PNG, WebP, or GIF image.');
    }

    $filename = bin2hex(random_bytes(16)) . '.' . $extensions[$mime];
    $target = UPLOAD_PATH . '/' . $filename;

    if (!move_uploaded_file($_FILES['photo']['tmp_name'], $target)) {
        throw new RuntimeException('Could not save uploaded photo.');
    }

    if ($existingPath) {
        $oldPath = UPLOAD_PATH . '/' . basename($existingPath);
        if (is_file($oldPath)) {
            unlink($oldPath);
        }
    }

    return UPLOAD_URL . '/' . $filename;
}

function render(string $view, array $data = []): void
{
    extract($data, EXTR_SKIP);
    $currentUser = current_user();
    $flash = flash();
    require BASE_PATH . '/views/layout.php';
}
