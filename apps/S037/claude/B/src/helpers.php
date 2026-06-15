<?php

declare(strict_types=1);

namespace App;

use PDO;

/* ------------------------------------------------------------------ *
 *  Output encoding (context: HTML text / attributes)
 * ------------------------------------------------------------------ */

/** HTML-escape a value for safe output. Use everywhere user data is printed. */
function e(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/* ------------------------------------------------------------------ *
 *  Request helpers / routing
 * ------------------------------------------------------------------ */

function method(): string
{
    return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
}

function path(): string
{
    $uri = $_SERVER['REQUEST_URI'] ?? '/';
    $path = parse_url($uri, PHP_URL_PATH);
    return is_string($path) ? rawurldecode($path) : '/';
}

function redirect(string $to): never
{
    header('Location: ' . $to, true, 302);
    exit;
}

function abort(int $code, string $message = ''): never
{
    http_response_code($code);
    $titles = [400 => 'Bad Request', 403 => 'Forbidden', 404 => 'Not Found', 413 => 'Payload Too Large'];
    $title = $titles[$code] ?? 'Error';
    render('error', ['code' => $code, 'title' => $title, 'message' => $message]);
    exit;
}

/* ------------------------------------------------------------------ *
 *  Flash messages (one-shot notices stored in the session)
 * ------------------------------------------------------------------ */

function flash(string $message, string $type = 'info'): void
{
    $_SESSION['__flash'][] = ['type' => $type, 'message' => $message];
}

function take_flashes(): array
{
    $flashes = $_SESSION['__flash'] ?? [];
    unset($_SESSION['__flash']);
    return $flashes;
}

/* ------------------------------------------------------------------ *
 *  CSRF protection
 * ------------------------------------------------------------------ */

function csrf_token(): string
{
    if (empty($_SESSION['__csrf'])) {
        $_SESSION['__csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['__csrf'];
}

function csrf_field(): string
{
    return '<input type="hidden" name="_csrf" value="' . e(csrf_token()) . '">';
}

/** Validate the CSRF token on a state-changing request; abort on mismatch. */
function require_csrf(): void
{
    $sent = (string) ($_POST['_csrf'] ?? '');
    $known = (string) ($_SESSION['__csrf'] ?? '');
    if ($known === '' || !hash_equals($known, $sent)) {
        abort(403, 'Invalid or missing CSRF token. Please reload and try again.');
    }
}

/* ------------------------------------------------------------------ *
 *  Authentication / authorisation
 * ------------------------------------------------------------------ */

function current_user(): ?array
{
    $id = $_SESSION['user_id'] ?? null;
    if ($id === null) {
        return null;
    }
    $stmt = Database::connection()->prepare('SELECT id, username FROM users WHERE id = :id');
    $stmt->execute([':id' => $id]);
    $user = $stmt->fetch();
    return $user ?: null;
}

function require_login(): array
{
    $user = current_user();
    if ($user === null) {
        flash('Please sign in to continue.', 'info');
        redirect('/login');
    }
    return $user;
}

function login_user(int $userId): void
{
    // New privilege level -> new session id.
    session_regenerate_id(true);
    $_SESSION['user_id'] = $userId;
}

function logout_user(): void
{
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires'  => time() - 42000,
            'path'     => $params['path'],
            'domain'   => $params['domain'],
            'secure'   => $params['secure'],
            'httponly' => $params['httponly'],
            'samesite' => $params['samesite'] ?? 'Lax',
        ]);
    }
    session_destroy();
}

/* ------------------------------------------------------------------ *
 *  Validation helpers
 * ------------------------------------------------------------------ */

/** Username: 3–32 chars, letters/digits/_/-/. only. */
function valid_username(string $username): bool
{
    return (bool) preg_match('/^[A-Za-z0-9_.-]{3,32}$/', $username);
}

/* ------------------------------------------------------------------ *
 *  Views
 * ------------------------------------------------------------------ */

function render(string $view, array $data = []): void
{
    $file = ROOT_DIR . '/src/views/' . $view . '.php';
    if (!is_file($file)) {
        throw new \RuntimeException('View not found: ' . $view);
    }
    $user    = $_SESSION['user_id'] ?? null ? current_user() : null;
    $flashes = take_flashes();
    extract($data, EXTR_SKIP);

    ob_start();
    require $file;
    $content = ob_get_clean();

    require ROOT_DIR . '/src/views/layout.php';
}

/* ------------------------------------------------------------------ *
 *  Image handling
 * ------------------------------------------------------------------ */

/**
 * Detect the real MIME type from the file's bytes (not the client claim) and
 * return it only if it is in the allow-list. Returns null otherwise.
 */
function sniff_allowed_image(string $tmpPath): ?string
{
    if (!is_file($tmpPath)) {
        return null;
    }
    $finfo = new \finfo(FILEINFO_MIME_TYPE);
    $mime  = $finfo->file($tmpPath) ?: '';

    // Cross-check with getimagesize so we only accept genuinely decodable images.
    $info = @getimagesize($tmpPath);
    if ($info === false) {
        return null;
    }

    return isset(ALLOWED_IMAGE_TYPES[$mime]) ? $mime : null;
}

/**
 * Create a JPEG/PNG/GIF/WebP thumbnail (longest side <= $max) and write it to
 * $destPath. Returns true on success.
 */
function make_thumbnail(string $srcPath, string $mime, string $destPath, int $max = 320): bool
{
    $data = file_get_contents($srcPath);
    if ($data === false) {
        return false;
    }
    $src = @imagecreatefromstring($data);
    if ($src === false) {
        return false;
    }

    $w = imagesx($src);
    $h = imagesy($src);
    $scale = min(1.0, $max / max($w, $h));
    $tw = max(1, (int) round($w * $scale));
    $th = max(1, (int) round($h * $scale));

    $thumb = imagecreatetruecolor($tw, $th);

    // Preserve transparency for formats that support it.
    if (in_array($mime, ['image/png', 'image/gif', 'image/webp'], true)) {
        imagealphablending($thumb, false);
        imagesavealpha($thumb, true);
        $transparent = imagecolorallocatealpha($thumb, 0, 0, 0, 127);
        imagefilledrectangle($thumb, 0, 0, $tw, $th, $transparent);
    }

    imagecopyresampled($thumb, $src, 0, 0, 0, 0, $tw, $th, $w, $h);

    $ok = match ($mime) {
        'image/jpeg' => imagejpeg($thumb, $destPath, 82),
        'image/png'  => imagepng($thumb, $destPath, 6),
        'image/gif'  => imagegif($thumb, $destPath),
        'image/webp' => function_exists('imagewebp') ? imagewebp($thumb, $destPath, 82) : false,
        default      => false,
    };

    imagedestroy($src);
    imagedestroy($thumb);
    return $ok;
}

/**
 * Resolve a stored upload filename to an absolute path, guaranteeing it stays
 * within the upload directory (path-traversal containment).
 */
function safe_upload_path(string $storedName): ?string
{
    // Only ever trust our own naming scheme.
    if (!preg_match('/^[a-f0-9]{32}(?:_thumb)?\.[a-z0-9]{2,5}$/', $storedName)) {
        return null;
    }
    $base = upload_dir();
    $full = $base . DIRECTORY_SEPARATOR . $storedName;
    $real = realpath($full);
    if ($real === false) {
        return null;
    }
    // Containment check.
    $baseReal = realpath($base);
    if ($baseReal === false || !str_starts_with($real, $baseReal . DIRECTORY_SEPARATOR)) {
        return null;
    }
    return $real;
}
