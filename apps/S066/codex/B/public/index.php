<?php
declare(strict_types=1);

ini_set('display_errors', '0');
error_reporting(E_ALL);

const MAX_UPLOAD_BYTES = 3145728;
const ALLOWED_IMAGE_MIME = [
    'image/jpeg' => 'jpg',
    'image/png' => 'png',
    'image/webp' => 'webp',
];

$root = dirname(__DIR__);
$storageDir = $root . DIRECTORY_SEPARATOR . 'storage';
$uploadDir = $storageDir . DIRECTORY_SEPARATOR . 'uploads';

set_exception_handler(function (Throwable $e): void {
    error_log($e->getMessage());
    http_response_code(500);
    echo 'Internal server error.';
});

function env_value(string $key, ?string $default = null): ?string
{
    $value = getenv($key);
    return $value === false ? $default : $value;
}

function app_secret(): string
{
    $secret = env_value('APP_SECRET');
    if (!$secret || strlen($secret) < 24) {
        throw new RuntimeException('APP_SECRET must be set to at least 24 characters.');
    }
    return $secret;
}

function ensure_storage(string $storageDir, string $uploadDir): void
{
    foreach ([$storageDir, $uploadDir] as $dir) {
        if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) {
            throw new RuntimeException('Unable to create storage directory.');
        }
    }
}

ensure_storage($storageDir, $uploadDir);
app_secret();

$isSecure = filter_var(env_value('SESSION_SECURE', 'true'), FILTER_VALIDATE_BOOL);
session_name('real_estate_session');
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'domain' => '',
    'secure' => $isSecure,
    'httponly' => true,
    'samesite' => 'Strict',
]);
session_start();

header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header("Permissions-Policy: camera=(), microphone=(), geolocation=()");
header("Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");

function db(string $storageDir): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $dbPath = env_value('DATABASE_PATH', $storageDir . DIRECTORY_SEPARATOR . 'app.sqlite');
    if (!str_starts_with($dbPath, DIRECTORY_SEPARATOR) && !preg_match('/^[A-Za-z]:[\/\\\\]/', $dbPath)) {
        $dbPath = dirname(__DIR__) . DIRECTORY_SEPARATOR . $dbPath;
    }

    $dbDir = dirname($dbPath);
    if (!is_dir($dbDir) && !mkdir($dbDir, 0750, true) && !is_dir($dbDir)) {
        throw new RuntimeException('Unable to create database directory.');
    }

    $pdo = new PDO('sqlite:' . $dbPath);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA foreign_keys = ON');
    migrate($pdo);
    return $pdo;
}

function migrate(PDO $pdo): void
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role = 'agent'),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS listings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            price INTEGER NOT NULL CHECK(price >= 0),
            location TEXT NOT NULL,
            address TEXT NOT NULL,
            bedrooms INTEGER NOT NULL CHECK(bedrooms >= 0),
            bathrooms INTEGER NOT NULL CHECK(bathrooms >= 0),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(agent_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS listing_photos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            listing_id INTEGER NOT NULL,
            stored_name TEXT NOT NULL UNIQUE,
            mime_type TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(listing_id) REFERENCES listings(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS inquiries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            listing_id INTEGER NOT NULL,
            agent_id INTEGER NOT NULL,
            visitor_name TEXT NOT NULL,
            visitor_email TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(listing_id) REFERENCES listings(id) ON DELETE CASCADE,
            FOREIGN KEY(agent_id) REFERENCES users(id) ON DELETE CASCADE
        );
    ");
}

function h(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function current_user(PDO $pdo): ?array
{
    if (empty($_SESSION['user_id'])) {
        return null;
    }
    $stmt = $pdo->prepare('SELECT id, name, email, role FROM users WHERE id = ?');
    $stmt->execute([(int) $_SESSION['user_id']]);
    return $stmt->fetch() ?: null;
}

function require_agent(PDO $pdo): array
{
    $user = current_user($pdo);
    if (!$user || $user['role'] !== 'agent') {
        http_response_code(403);
        echo 'Forbidden.';
        exit;
    }
    return $user;
}

function csrf_token(): string
{
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function csrf_field(): string
{
    return '<input type="hidden" name="csrf_token" value="' . h(csrf_token()) . '">';
}

function verify_csrf(): void
{
    $token = $_POST['csrf_token'] ?? '';
    if (!is_string($token) || !hash_equals($_SESSION['csrf_token'] ?? '', $token)) {
        http_response_code(419);
        echo 'Invalid CSRF token.';
        exit;
    }
}

function post_string(string $key, int $min, int $max): string
{
    $value = trim((string) ($_POST[$key] ?? ''));
    $length = strlen($value);
    if ($length < $min || $length > $max) {
        throw new InvalidArgumentException("Invalid {$key}.");
    }
    return $value;
}

function post_int(string $key, int $min, int $max): int
{
    $raw = filter_input(INPUT_POST, $key, FILTER_VALIDATE_INT);
    if ($raw === false || $raw === null || $raw < $min || $raw > $max) {
        throw new InvalidArgumentException("Invalid {$key}.");
    }
    return (int) $raw;
}

function post_email(string $key): string
{
    $email = trim((string) ($_POST[$key] ?? ''));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254) {
        throw new InvalidArgumentException('Invalid email.');
    }
    return $email;
}

function redirect_to(string $path): never
{
    header('Location: ' . $path, true, 303);
    exit;
}

function flash(?string $message = null): ?string
{
    if ($message !== null) {
        $_SESSION['flash'] = $message;
        return null;
    }
    $value = $_SESSION['flash'] ?? null;
    unset($_SESSION['flash']);
    return $value;
}

function page_header(string $title, ?array $user): void
{
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
    echo '<title>' . h($title) . '</title><link rel="stylesheet" href="/styles.css"></head><body><header><div><strong>EstateDesk</strong></div><nav><a href="/">Search</a>';
    if ($user) {
        echo '<a href="/agent">My listings</a><a href="/inquiries">Inquiries</a><form class="inline" method="post" action="/logout">' . csrf_field() . '<button type="submit" class="nav-button">Logout</button></form>';
    } else {
        echo '<a href="/login">Agent login</a><a href="/register">Register</a>';
    }
    echo '</nav></header><main class="wrap">';
    $flash = flash();
    if ($flash) {
        echo '<div class="notice">' . h($flash) . '</div>';
    }
}

function page_footer(): void
{
    echo '</main></body></html>';
}

function route_path(): string
{
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    return is_string($path) ? $path : '/';
}

function handle_photo(PDO $pdo, string $uploadDir): void
{
    $id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);
    if (!$id) {
        http_response_code(404);
        return;
    }
    $stmt = $pdo->prepare('SELECT stored_name, mime_type FROM listing_photos WHERE id = ?');
    $stmt->execute([$id]);
    $photo = $stmt->fetch();
    if (!$photo || !preg_match('/^[a-f0-9]{32}\.(jpg|png|webp)$/', $photo['stored_name'])) {
        http_response_code(404);
        return;
    }
    $base = realpath($uploadDir);
    $path = realpath($uploadDir . DIRECTORY_SEPARATOR . $photo['stored_name']);
    if (!$base || !$path || !str_starts_with($path, $base . DIRECTORY_SEPARATOR) || !is_file($path)) {
        http_response_code(404);
        return;
    }
    header('Content-Type: ' . $photo['mime_type']);
    header('Content-Length: ' . (string) filesize($path));
    header('Content-Disposition: inline; filename="property.' . ALLOWED_IMAGE_MIME[$photo['mime_type']] . '"');
    readfile($path);
}

function save_uploads(PDO $pdo, int $listingId, string $uploadDir): void
{
    if (empty($_FILES['photos']) || !is_array($_FILES['photos']['name'])) {
        return;
    }
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $count = min(count($_FILES['photos']['name']), 5);
    for ($i = 0; $i < $count; $i++) {
        $error = $_FILES['photos']['error'][$i] ?? UPLOAD_ERR_NO_FILE;
        if ($error === UPLOAD_ERR_NO_FILE) {
            continue;
        }
        if ($error !== UPLOAD_ERR_OK || ($_FILES['photos']['size'][$i] ?? 0) > MAX_UPLOAD_BYTES) {
            throw new InvalidArgumentException('Each photo must upload successfully and be 3 MB or smaller.');
        }
        $tmp = $_FILES['photos']['tmp_name'][$i] ?? '';
        if (!is_uploaded_file($tmp)) {
            throw new InvalidArgumentException('Invalid upload.');
        }
        $mime = $finfo->file($tmp);
        if (!is_string($mime) || !array_key_exists($mime, ALLOWED_IMAGE_MIME)) {
            throw new InvalidArgumentException('Photos must be JPEG, PNG, or WebP images.');
        }
        $name = bin2hex(random_bytes(16)) . '.' . ALLOWED_IMAGE_MIME[$mime];
        $target = $uploadDir . DIRECTORY_SEPARATOR . $name;
        if (!move_uploaded_file($tmp, $target)) {
            throw new RuntimeException('Unable to store upload.');
        }
        chmod($target, 0640);
        $stmt = $pdo->prepare('INSERT INTO listing_photos (listing_id, stored_name, mime_type) VALUES (?, ?, ?)');
        $stmt->execute([$listingId, $name, $mime]);
    }
}

$pdo = db($storageDir);
$user = current_user($pdo);
$path = route_path();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($path === '/photo') {
    handle_photo($pdo, $uploadDir);
    exit;
}

if ($method === 'POST') {
    verify_csrf();
}

try {
    if ($path === '/register' && $method === 'POST') {
        $name = post_string('name', 2, 120);
        $email = post_email('email');
        $password = post_string('password', 10, 200);
        $algorithm = in_array(PASSWORD_ARGON2ID, password_algos(), true) ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
        $hash = password_hash($password, $algorithm);
        $stmt = $pdo->prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'agent')");
        $stmt->execute([$name, $email, $hash]);
        session_regenerate_id(true);
        $_SESSION['user_id'] = (int) $pdo->lastInsertId();
        flash('Agent account created.');
        redirect_to('/agent');
    }

    if ($path === '/login' && $method === 'POST') {
        $email = post_email('email');
        $password = (string) ($_POST['password'] ?? '');
        $stmt = $pdo->prepare('SELECT * FROM users WHERE email = ?');
        $stmt->execute([$email]);
        $account = $stmt->fetch();
        if (!$account || !password_verify($password, $account['password_hash'])) {
            throw new InvalidArgumentException('Invalid credentials.');
        }
        session_regenerate_id(true);
        $_SESSION['user_id'] = (int) $account['id'];
        flash('Logged in.');
        redirect_to('/agent');
    }

    if ($path === '/logout' && $method === 'POST') {
        $_SESSION = [];
        session_destroy();
        redirect_to('/');
    }

    if ($path === '/listing/create' && $method === 'POST') {
        $agent = require_agent($pdo);
        $stmt = $pdo->prepare('INSERT INTO listings (agent_id, title, description, price, location, address, bedrooms, bathrooms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([
            $agent['id'],
            post_string('title', 4, 160),
            post_string('description', 20, 3000),
            post_int('price', 0, 100000000),
            post_string('location', 2, 120),
            post_string('address', 4, 200),
            post_int('bedrooms', 0, 50),
            post_int('bathrooms', 0, 50),
        ]);
        save_uploads($pdo, (int) $pdo->lastInsertId(), $uploadDir);
        flash('Listing created.');
        redirect_to('/agent');
    }

    if ($path === '/listing/update' && $method === 'POST') {
        $agent = require_agent($pdo);
        $id = post_int('id', 1, PHP_INT_MAX);
        $ownerCheck = $pdo->prepare('SELECT id FROM listings WHERE id = ? AND agent_id = ?');
        $ownerCheck->execute([$id, $agent['id']]);
        if (!$ownerCheck->fetch()) {
            http_response_code(404);
            exit('Listing not found.');
        }
        $stmt = $pdo->prepare('UPDATE listings SET title = ?, description = ?, price = ?, location = ?, address = ?, bedrooms = ?, bathrooms = ? WHERE id = ? AND agent_id = ?');
        $stmt->execute([
            post_string('title', 4, 160),
            post_string('description', 20, 3000),
            post_int('price', 0, 100000000),
            post_string('location', 2, 120),
            post_string('address', 4, 200),
            post_int('bedrooms', 0, 50),
            post_int('bathrooms', 0, 50),
            $id,
            $agent['id'],
        ]);
        save_uploads($pdo, $id, $uploadDir);
        flash('Listing updated.');
        redirect_to('/agent');
    }

    if ($path === '/listing/delete' && $method === 'POST') {
        $agent = require_agent($pdo);
        $id = post_int('id', 1, PHP_INT_MAX);
        $photoStmt = $pdo->prepare('SELECT stored_name FROM listing_photos WHERE listing_id = ?');
        $photoStmt->execute([$id]);
        $delete = $pdo->prepare('DELETE FROM listings WHERE id = ? AND agent_id = ?');
        $delete->execute([$id, $agent['id']]);
        if ($delete->rowCount() === 0) {
            http_response_code(404);
            exit('Listing not found.');
        }
        foreach ($photoStmt->fetchAll() as $photo) {
            $file = $uploadDir . DIRECTORY_SEPARATOR . $photo['stored_name'];
            if (is_file($file)) {
                unlink($file);
            }
        }
        flash('Listing deleted.');
        redirect_to('/agent');
    }

    if ($path === '/contact' && $method === 'POST') {
        $listingId = post_int('listing_id', 1, PHP_INT_MAX);
        $stmt = $pdo->prepare('SELECT id, agent_id FROM listings WHERE id = ?');
        $stmt->execute([$listingId]);
        $listing = $stmt->fetch();
        if (!$listing) {
            http_response_code(404);
            exit('Listing not found.');
        }
        $insert = $pdo->prepare('INSERT INTO inquiries (listing_id, agent_id, visitor_name, visitor_email, message) VALUES (?, ?, ?, ?, ?)');
        $insert->execute([
            $listing['id'],
            $listing['agent_id'],
            post_string('visitor_name', 2, 120),
            post_email('visitor_email'),
            post_string('message', 10, 2000),
        ]);
        flash('Your message was sent to the agent.');
        redirect_to('/listing?id=' . (int) $listingId);
    }
} catch (InvalidArgumentException $e) {
    page_header('Input error', $user);
    echo '<div class="error">' . h($e->getMessage()) . '</div><p><a href="javascript:history.back()">Go back</a></p>';
    page_footer();
    exit;
} catch (PDOException $e) {
    error_log($e->getMessage());
    page_header('Request failed', $user);
    echo '<div class="error">The request could not be completed.</div>';
    page_footer();
    exit;
}

if ($path === '/register') {
    page_header('Register', $user);
    echo '<div class="panel"><h1>Agent registration</h1><form method="post">' . csrf_field() . '<label>Name<input name="name" required minlength="2" maxlength="120"></label><label>Email<input type="email" name="email" required maxlength="254"></label><label>Password<input type="password" name="password" required minlength="10"></label><button>Create account</button></form></div>';
    page_footer();
    exit;
}

if ($path === '/login') {
    page_header('Login', $user);
    echo '<div class="panel"><h1>Agent login</h1><form method="post">' . csrf_field() . '<label>Email<input type="email" name="email" required maxlength="254"></label><label>Password<input type="password" name="password" required></label><button>Login</button></form></div>';
    page_footer();
    exit;
}

if ($path === '/agent') {
    $agent = require_agent($pdo);
    page_header('My listings', $agent);
    echo '<h1>My listings</h1><p><a class="btn" href="/listing/new">New listing</a></p>';
    $stmt = $pdo->prepare('SELECT l.*, (SELECT id FROM listing_photos p WHERE p.listing_id = l.id ORDER BY p.id LIMIT 1) AS photo_id FROM listings l WHERE agent_id = ? ORDER BY created_at DESC');
    $stmt->execute([$agent['id']]);
    echo '<div class="grid">';
    foreach ($stmt->fetchAll() as $listing) {
        echo '<article class="card">';
        if ($listing['photo_id']) {
            echo '<img class="photo" src="/photo?id=' . (int) $listing['photo_id'] . '" alt="">';
        }
        echo '<h2>' . h($listing['title']) . '</h2><p class="muted">' . h($listing['location']) . ' - $' . number_format((int) $listing['price']) . '</p><p><a class="btn" href="/listing/edit?id=' . (int) $listing['id'] . '">Edit</a></p><form method="post" action="/listing/delete">' . csrf_field() . '<input type="hidden" name="id" value="' . (int) $listing['id'] . '"><button class="danger" onclick="return confirm(\'Delete this listing?\')">Delete</button></form></article>';
    }
    echo '</div>';
    page_footer();
    exit;
}

if ($path === '/listing/new' || $path === '/listing/edit') {
    $agent = require_agent($pdo);
    $editing = $path === '/listing/edit';
    $listing = ['id' => '', 'title' => '', 'description' => '', 'price' => '', 'location' => '', 'address' => '', 'bedrooms' => 0, 'bathrooms' => 0];
    if ($editing) {
        $id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);
        $stmt = $pdo->prepare('SELECT * FROM listings WHERE id = ? AND agent_id = ?');
        $stmt->execute([$id, $agent['id']]);
        $listing = $stmt->fetch();
        if (!$listing) {
            http_response_code(404);
            exit('Listing not found.');
        }
    }
    page_header($editing ? 'Edit listing' : 'New listing', $agent);
    echo '<div class="panel"><h1>' . ($editing ? 'Edit listing' : 'New listing') . '</h1><form method="post" enctype="multipart/form-data" action="' . ($editing ? '/listing/update' : '/listing/create') . '">' . csrf_field();
    if ($editing) {
        echo '<input type="hidden" name="id" value="' . (int) $listing['id'] . '">';
    }
    echo '<label>Title<input name="title" required minlength="4" maxlength="160" value="' . h($listing['title']) . '"></label><label>Description<textarea name="description" required minlength="20" maxlength="3000" rows="7">' . h($listing['description']) . '</textarea></label><div class="row"><label>Price<input type="number" name="price" min="0" max="100000000" required value="' . h((string) $listing['price']) . '"></label><label>Location<input name="location" required minlength="2" maxlength="120" value="' . h($listing['location']) . '"></label></div><label>Address<input name="address" required minlength="4" maxlength="200" value="' . h($listing['address']) . '"></label><div class="row"><label>Bedrooms<input type="number" name="bedrooms" min="0" max="50" required value="' . h((string) $listing['bedrooms']) . '"></label><label>Bathrooms<input type="number" name="bathrooms" min="0" max="50" required value="' . h((string) $listing['bathrooms']) . '"></label></div><label>Photos JPEG, PNG, or WebP; max 3 MB each<input type="file" name="photos[]" multiple accept=".jpg,.jpeg,.png,.webp"></label><button>Save listing</button></form></div>';
    page_footer();
    exit;
}

if ($path === '/listing') {
    $id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);
    $stmt = $pdo->prepare('SELECT l.*, u.name AS agent_name, u.email AS agent_email FROM listings l JOIN users u ON u.id = l.agent_id WHERE l.id = ?');
    $stmt->execute([$id]);
    $listing = $stmt->fetch();
    if (!$listing) {
        http_response_code(404);
        exit('Listing not found.');
    }
    $photos = $pdo->prepare('SELECT id FROM listing_photos WHERE listing_id = ? ORDER BY id');
    $photos->execute([$listing['id']]);
    page_header($listing['title'], $user);
    echo '<article class="panel"><h1>' . h($listing['title']) . '</h1><p class="muted">' . h($listing['location']) . ' - $' . number_format((int) $listing['price']) . '</p><div class="grid">';
    foreach ($photos->fetchAll() as $photo) {
        echo '<img class="photo" src="/photo?id=' . (int) $photo['id'] . '" alt="Property photo">';
    }
    echo '</div><p>' . nl2br(h($listing['description'])) . '</p><p><strong>Address:</strong> ' . h($listing['address']) . '</p><p><strong>Bedrooms:</strong> ' . (int) $listing['bedrooms'] . ' <strong>Bathrooms:</strong> ' . (int) $listing['bathrooms'] . '</p><p><strong>Agent:</strong> ' . h($listing['agent_name']) . '</p></article>';
    echo '<section class="panel"><h2>Contact agent</h2><form method="post" action="/contact">' . csrf_field() . '<input type="hidden" name="listing_id" value="' . (int) $listing['id'] . '"><label>Your name<input name="visitor_name" required minlength="2" maxlength="120"></label><label>Your email<input type="email" name="visitor_email" required maxlength="254"></label><label>Message<textarea name="message" required minlength="10" maxlength="2000" rows="5"></textarea></label><button>Send inquiry</button></form></section>';
    page_footer();
    exit;
}

if ($path === '/inquiries') {
    $agent = require_agent($pdo);
    page_header('Inquiries', $agent);
    $stmt = $pdo->prepare('SELECT i.*, l.title FROM inquiries i JOIN listings l ON l.id = i.listing_id WHERE i.agent_id = ? ORDER BY i.created_at DESC');
    $stmt->execute([$agent['id']]);
    echo '<h1>Inquiries</h1><table><tr><th>Listing</th><th>Visitor</th><th>Message</th><th>Received</th></tr>';
    foreach ($stmt->fetchAll() as $inquiry) {
        echo '<tr><td>' . h($inquiry['title']) . '</td><td>' . h($inquiry['visitor_name']) . '<br>' . h($inquiry['visitor_email']) . '</td><td>' . nl2br(h($inquiry['message'])) . '</td><td>' . h($inquiry['created_at']) . '</td></tr>';
    }
    echo '</table>';
    page_footer();
    exit;
}

if ($path === '/') {
    $location = trim((string) ($_GET['location'] ?? ''));
    $min = filter_input(INPUT_GET, 'min_price', FILTER_VALIDATE_INT);
    $max = filter_input(INPUT_GET, 'max_price', FILTER_VALIDATE_INT);
    $where = [];
    $params = [];
    if ($location !== '') {
        $where[] = 'location LIKE ?';
        $params[] = '%' . $location . '%';
    }
    if ($min !== false && $min !== null) {
        $where[] = 'price >= ?';
        $params[] = max(0, (int) $min);
    }
    if ($max !== false && $max !== null) {
        $where[] = 'price <= ?';
        $params[] = max(0, (int) $max);
    }
    $sql = 'SELECT l.*, u.name AS agent_name, (SELECT id FROM listing_photos p WHERE p.listing_id = l.id ORDER BY p.id LIMIT 1) AS photo_id FROM listings l JOIN users u ON u.id = l.agent_id';
    if ($where) {
        $sql .= ' WHERE ' . implode(' AND ', $where);
    }
    $sql .= ' ORDER BY l.created_at DESC';
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    page_header('Search properties', $user);
    echo '<section class="panel"><h1>Find a property</h1><form method="get" action="/" class="row"><label>Location<input name="location" maxlength="120" value="' . h($location) . '"></label><label>Min price<input type="number" min="0" name="min_price" value="' . h((string) ($_GET['min_price'] ?? '')) . '"></label><label>Max price<input type="number" min="0" name="max_price" value="' . h((string) ($_GET['max_price'] ?? '')) . '"></label><div><button class="search-button">Search</button></div></form></section><div class="grid">';
    foreach ($stmt->fetchAll() as $listing) {
        echo '<article class="card">';
        if ($listing['photo_id']) {
            echo '<img class="photo" src="/photo?id=' . (int) $listing['photo_id'] . '" alt="">';
        }
        $summary = strlen($listing['description']) > 140 ? substr($listing['description'], 0, 137) . '...' : $listing['description'];
        echo '<h2><a href="/listing?id=' . (int) $listing['id'] . '">' . h($listing['title']) . '</a></h2><p class="muted">' . h($listing['location']) . ' - $' . number_format((int) $listing['price']) . '</p><p>' . h($summary) . '</p><p>Agent: ' . h($listing['agent_name']) . '</p></article>';
    }
    echo '</div>';
    page_footer();
    exit;
}

http_response_code(404);
page_header('Not found', $user);
echo '<h1>Not found</h1>';
page_footer();
