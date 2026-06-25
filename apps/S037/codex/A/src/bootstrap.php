<?php
declare(strict_types=1);

session_start();

const MAX_UPLOAD_BYTES = 5_242_880;
const UPLOAD_DIR = __DIR__ . '/../public/uploads';
const DATA_DIR = __DIR__ . '/../data';

initialize_storage();

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
    migrate($pdo);

    return $pdo;
}

function initialize_storage(): void
{
    foreach ([DATA_DIR, UPLOAD_DIR, UPLOAD_DIR . '/thumbs'] as $dir) {
        if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new RuntimeException('Unable to create storage directory.');
        }
    }
}

function migrate(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )'
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            caption TEXT NOT NULL,
            file_path TEXT NOT NULL,
            thumb_path TEXT,
            mime_type TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )'
    );
}

function h(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function redirect(string $path): never
{
    header('Location: ' . $path);
    exit;
}

function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }

    return (string) $_SESSION['csrf'];
}

function verify_csrf(): void
{
    $sent = (string) ($_POST['csrf'] ?? '');
    if ($sent === '' || !hash_equals(csrf_token(), $sent)) {
        http_response_code(419);
        exit('Invalid form token.');
    }
}

function set_flash(string $type, string $message): void
{
    $_SESSION['flash'] = ['type' => $type, 'message' => $message];
}

function flash(): ?array
{
    $flash = $_SESSION['flash'] ?? null;
    unset($_SESSION['flash']);

    return is_array($flash) ? $flash : null;
}

function create_user(string $username, string $password): void
{
    $stmt = db()->prepare('INSERT INTO users (username, password_hash) VALUES (:username, :password_hash)');

    try {
        $stmt->execute([
            ':username' => $username,
            ':password_hash' => password_hash($password, PASSWORD_DEFAULT),
        ]);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') {
            throw new RuntimeException('That username is already taken.');
        }

        throw $e;
    }
}

function authenticate(string $username, string $password): bool
{
    $stmt = db()->prepare('SELECT * FROM users WHERE username = :username');
    $stmt->execute([':username' => $username]);
    $user = $stmt->fetch();

    return $user && password_verify($password, $user['password_hash']);
}

function login_user(string $username): void
{
    $stmt = db()->prepare('SELECT id FROM users WHERE username = :username');
    $stmt->execute([':username' => $username]);
    $user = $stmt->fetch();

    if (!$user) {
        throw new RuntimeException('Unable to log in.');
    }

    session_regenerate_id(true);
    $_SESSION['user_id'] = (int) $user['id'];
}

function current_user(): ?array
{
    if (empty($_SESSION['user_id'])) {
        return null;
    }

    $stmt = db()->prepare('SELECT id, username FROM users WHERE id = :id');
    $stmt->execute([':id' => (int) $_SESSION['user_id']]);
    $user = $stmt->fetch();

    return $user ?: null;
}

function require_login(): void
{
    if (!current_user()) {
        set_flash('error', 'Log in to upload images.');
        redirect('/login.php');
    }
}

function save_uploaded_image(array $file, string $caption, int $userId): void
{
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        throw new RuntimeException('Upload failed. Choose a valid image file.');
    }

    if (($file['size'] ?? 0) > MAX_UPLOAD_BYTES) {
        throw new RuntimeException('Images must be 5 MB or smaller.');
    }

    $tmpPath = (string) $file['tmp_name'];
    $info = getimagesize($tmpPath);
    if (!$info || empty($info['mime'])) {
        throw new RuntimeException('The uploaded file is not a valid image.');
    }

    $extensions = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/gif' => 'gif',
        'image/webp' => 'webp',
    ];

    $mime = (string) $info['mime'];
    if (!isset($extensions[$mime])) {
        throw new RuntimeException('Upload a JPEG, PNG, GIF, or WebP image.');
    }

    $name = bin2hex(random_bytes(16));
    $relative = 'uploads/' . $name . '.' . $extensions[$mime];
    $absolute = __DIR__ . '/../public/' . $relative;

    if (!move_uploaded_file($tmpPath, $absolute)) {
        throw new RuntimeException('Unable to store the uploaded image.');
    }

    $thumbRelative = create_thumbnail($absolute, $name, $mime);

    $stmt = db()->prepare(
        'INSERT INTO images (user_id, caption, file_path, thumb_path, mime_type)
         VALUES (:user_id, :caption, :file_path, :thumb_path, :mime_type)'
    );
    $stmt->execute([
        ':user_id' => $userId,
        ':caption' => $caption,
        ':file_path' => $relative,
        ':thumb_path' => $thumbRelative,
        ':mime_type' => $mime,
    ]);
}

function create_thumbnail(string $sourcePath, string $name, string $mime): ?string
{
    if (!extension_loaded('gd')) {
        return null;
    }

    $loader = match ($mime) {
        'image/jpeg' => 'imagecreatefromjpeg',
        'image/png' => 'imagecreatefrompng',
        'image/gif' => 'imagecreatefromgif',
        'image/webp' => 'imagecreatefromwebp',
        default => null,
    };

    if (!$loader || !function_exists($loader)) {
        return null;
    }

    $source = @$loader($sourcePath);
    if (!$source) {
        return null;
    }

    $width = imagesx($source);
    $height = imagesy($source);
    if ($width <= 0 || $height <= 0) {
        imagedestroy($source);
        return null;
    }

    $targetWidth = 640;
    $targetHeight = 480;
    $scale = max($targetWidth / $width, $targetHeight / $height);
    $cropWidth = (int) round($targetWidth / $scale);
    $cropHeight = (int) round($targetHeight / $scale);
    $srcX = (int) max(0, floor(($width - $cropWidth) / 2));
    $srcY = (int) max(0, floor(($height - $cropHeight) / 2));

    $thumb = imagecreatetruecolor($targetWidth, $targetHeight);
    imagecopyresampled($thumb, $source, 0, 0, $srcX, $srcY, $targetWidth, $targetHeight, $cropWidth, $cropHeight);

    $relative = 'uploads/thumbs/' . $name . '.jpg';
    $absolute = __DIR__ . '/../public/' . $relative;
    imagejpeg($thumb, $absolute, 82);

    imagedestroy($thumb);
    imagedestroy($source);

    return $relative;
}

function latest_images(): array
{
    $stmt = db()->query(
        'SELECT images.*, users.username
         FROM images
         JOIN users ON users.id = images.user_id
         ORDER BY images.created_at DESC, images.id DESC'
    );

    return $stmt->fetchAll();
}

function find_image(int $id): ?array
{
    $stmt = db()->prepare(
        'SELECT images.*, users.username
         FROM images
         JOIN users ON users.id = images.user_id
         WHERE images.id = :id'
    );
    $stmt->execute([':id' => $id]);
    $image = $stmt->fetch();

    return $image ?: null;
}

function public_image_path(string $path): string
{
    return '/' . ltrim($path, '/');
}

function format_date(string $date): string
{
    return date('M j, Y g:i A', strtotime($date) ?: time());
}
