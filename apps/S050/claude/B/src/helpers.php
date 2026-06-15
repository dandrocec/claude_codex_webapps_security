<?php
declare(strict_types=1);

/* ===========================================================================
 * Output encoding
 * ========================================================================= */

/** Context-aware HTML-escape for safe output (prevents XSS). */
function e(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/* ===========================================================================
 * HTTP helpers
 * ========================================================================= */

function redirect(string $path): never
{
    header('Location: ' . $path);
    exit;
}

function is_post(): bool
{
    return ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
}

function abort(int $status, string $message = ''): never
{
    http_response_code($status);
    render('error', [
        'title'   => $status . ' Error',
        'status'  => $status,
        'message' => $message !== '' ? $message : 'Request could not be completed.',
    ]);
    exit;
}

/* ===========================================================================
 * Flash messages (one-shot notices stored in the session)
 * ========================================================================= */

function flash(string $message): void
{
    $_SESSION['flash'][] = $message;
}

function take_flashes(): array
{
    $messages = $_SESSION['flash'] ?? [];
    unset($_SESSION['flash']);
    return $messages;
}

/* ===========================================================================
 * CSRF protection
 * ========================================================================= */

function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

/** Hidden form field carrying the CSRF token. */
function csrf_field(): string
{
    return '<input type="hidden" name="csrf_token" value="' . e(csrf_token()) . '">';
}

/** Verify the CSRF token on a state-changing request; abort on mismatch. */
function csrf_check(): void
{
    $sent = $_POST['csrf_token'] ?? '';
    if (!is_string($sent) || $sent === '' || !hash_equals(csrf_token(), $sent)) {
        abort(419, 'Invalid or missing CSRF token. Please reload and try again.');
    }
}

/* ===========================================================================
 * Authentication & access control
 * ========================================================================= */

function current_user(): ?array
{
    if (empty($_SESSION['user_id'])) {
        return null;
    }
    static $cache = null;
    if ($cache !== null && $cache['id'] === $_SESSION['user_id']) {
        return $cache;
    }
    $stmt = db()->prepare('SELECT id, username, created_at FROM users WHERE id = ?');
    $stmt->execute([$_SESSION['user_id']]);
    $user = $stmt->fetch();
    $cache = $user ?: null;
    return $cache;
}

function require_login(): array
{
    $user = current_user();
    if ($user === null) {
        flash('Please log in to continue.');
        redirect('/login');
    }
    return $user;
}

function login_user(int $userId): void
{
    // Prevent session fixation: issue a fresh session id on privilege change.
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
            'httponly' => true,
            'secure'   => $params['secure'],
            'samesite' => $params['samesite'],
        ]);
    }
    session_destroy();
}

/* ===========================================================================
 * View rendering
 * ========================================================================= */

function render(string $view, array $data = []): void
{
    extract($data, EXTR_SKIP);
    $flashes = take_flashes();
    $user = current_user();
    $viewFile = APP_ROOT . '/templates/' . $view . '.php';

    ob_start();
    require $viewFile;
    $content = ob_get_clean();

    require APP_ROOT . '/templates/layout.php';
}

/* ===========================================================================
 * Image upload validation & storage hardening
 * ========================================================================= */

/**
 * Validate and store an uploaded image.
 *
 * - Verifies the PHP upload status and enforces a maximum size.
 * - Detects the real MIME type from file content (finfo) and confirms it
 *   against an allow-list; the client-supplied name/type are never trusted.
 * - Cross-checks with getimagesize() so only genuine images are accepted.
 * - Saves under a server-generated random name inside UPLOAD_DIR, which lives
 *   outside the web root and is never executed.
 *
 * @return array{name:string, mime:string}  Stored filename and MIME type.
 * @throws RuntimeException with a user-safe message on any validation failure.
 */
function store_uploaded_image(array $file): array
{
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        $msg = ($file['error'] ?? null) === UPLOAD_ERR_INI_SIZE
            ? 'The image is too large.'
            : 'Please choose an image to upload.';
        throw new RuntimeException($msg);
    }

    if (!is_uploaded_file($file['tmp_name'])) {
        throw new RuntimeException('Invalid upload.');
    }

    if ($file['size'] <= 0 || $file['size'] > MAX_UPLOAD_BYTES) {
        $mb = round(MAX_UPLOAD_BYTES / 1048576, 1);
        throw new RuntimeException("The image must be between 1 byte and {$mb} MiB.");
    }

    // Detect MIME from actual content, not the client-provided header.
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime = (string) $finfo->file($file['tmp_name']);
    if (!isset(ALLOWED_IMAGE_TYPES[$mime])) {
        throw new RuntimeException('Only JPEG, PNG, GIF, or WebP images are allowed.');
    }

    // Confirm the bytes really decode as an image of the detected type.
    $info = @getimagesize($file['tmp_name']);
    if ($info === false) {
        throw new RuntimeException('The file is not a valid image.');
    }
    $detectedByGd = image_type_to_mime_type($info[2]);
    if ($detectedByGd !== $mime) {
        throw new RuntimeException('The file content does not match a supported image type.');
    }

    if (!is_dir(UPLOAD_DIR) && !mkdir(UPLOAD_DIR, 0750, true) && !is_dir(UPLOAD_DIR)) {
        throw new RuntimeException('Upload storage is unavailable.');
    }

    $ext = ALLOWED_IMAGE_TYPES[$mime];
    $name = bin2hex(random_bytes(16)) . '.' . $ext;
    $dest = UPLOAD_DIR . '/' . $name;

    if (!move_uploaded_file($file['tmp_name'], $dest)) {
        throw new RuntimeException('Could not save the uploaded image.');
    }
    @chmod($dest, 0640);

    return ['name' => $name, 'mime' => $mime];
}

/**
 * Resolve a stored image filename to a safe absolute path within UPLOAD_DIR.
 * Rejects anything that would escape the upload directory (path traversal).
 */
function safe_upload_path(string $storedName): ?string
{
    // Stored names are always 32 hex chars + known extension; enforce that.
    if (!preg_match('/^[a-f0-9]{32}\.(jpg|png|gif|webp)$/', $storedName)) {
        return null;
    }
    $base = realpath(UPLOAD_DIR);
    $path = realpath(UPLOAD_DIR . '/' . $storedName);
    if ($base === false || $path === false) {
        return null;
    }
    // Ensure the resolved path is strictly inside the upload directory.
    if (!str_starts_with($path, $base . DIRECTORY_SEPARATOR)) {
        return null;
    }
    return $path;
}

function delete_stored_image(string $storedName): void
{
    $path = safe_upload_path($storedName);
    if ($path !== null && is_file($path)) {
        @unlink($path);
    }
}
