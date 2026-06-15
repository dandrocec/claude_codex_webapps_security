<?php
declare(strict_types=1);

/**
 * Front controller for the photo blog.
 *
 * Run with PHP's built-in server:
 *   php -S 127.0.0.1:5050 -t public public/index.php
 */

// When using the built-in server, let it serve existing static assets
// (e.g. /style.css) directly instead of routing them.
if (PHP_SAPI === 'cli-server') {
    $requested = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    $static = __DIR__ . $requested;
    if ($requested !== '/' && is_file($static)) {
        return false;
    }
}

require __DIR__ . '/../src/config.php';
require __DIR__ . '/../src/db.php';
require __DIR__ . '/../src/helpers.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = rtrim(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/', '/') ?: '/';

/* ---------------------------------------------------------------------------
 * Routing
 * ------------------------------------------------------------------------- */
switch (true) {
    case $path === '/' && $method === 'GET':
        feed();
        break;

    case $path === '/register' && $method === 'GET':
        show_register();
        break;
    case $path === '/register' && $method === 'POST':
        do_register();
        break;

    case $path === '/login' && $method === 'GET':
        show_login();
        break;
    case $path === '/login' && $method === 'POST':
        do_login();
        break;

    case $path === '/logout' && $method === 'POST':
        do_logout();
        break;

    case $path === '/posts/new' && $method === 'GET':
        show_create();
        break;
    case $path === '/posts/new' && $method === 'POST':
        do_create();
        break;

    case $path === '/posts/edit' && $method === 'GET':
        show_edit();
        break;
    case $path === '/posts/edit' && $method === 'POST':
        do_edit();
        break;

    case $path === '/posts/delete' && $method === 'POST':
        do_delete();
        break;

    case (bool) preg_match('#^/media/(\d+)$#', $path, $m) && $method === 'GET':
        serve_media((int) $m[1]);
        break;

    default:
        abort(404, 'Page not found.');
}

/* ===========================================================================
 * Handlers
 * ========================================================================= */

function feed(): void
{
    $stmt = db()->query(
        'SELECT p.id, p.user_id, p.caption, p.created_at, u.username
         FROM posts p JOIN users u ON u.id = p.user_id
         ORDER BY p.created_at DESC, p.id DESC'
    );
    render('feed', ['posts' => $stmt->fetchAll()]);
}

/* ----------------------------- Registration ----------------------------- */

function show_register(): void
{
    if (current_user()) {
        redirect('/');
    }
    render('register', ['username' => '']);
}

function do_register(): void
{
    csrf_check();
    if (current_user()) {
        redirect('/');
    }

    $username = trim((string) ($_POST['username'] ?? ''));
    $password = (string) ($_POST['password'] ?? '');
    $confirm  = (string) ($_POST['password_confirm'] ?? '');
    $errors = [];

    if (!preg_match('/^[A-Za-z0-9_]{3,30}$/', $username)) {
        $errors[] = 'Username must be 3–30 characters: letters, numbers, or underscores.';
    }
    if (strlen($password) < 8 || strlen($password) > 200) {
        $errors[] = 'Password must be between 8 and 200 characters.';
    }
    if ($password !== $confirm) {
        $errors[] = 'Passwords do not match.';
    }

    if (!$errors) {
        $hash = password_hash($password, defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT);
        try {
            $stmt = db()->prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
            $stmt->execute([$username, $hash]);
        } catch (PDOException $e) {
            // UNIQUE constraint violation -> username taken (avoid leaking details).
            $errors[] = 'That username is not available.';
        }
    }

    if ($errors) {
        http_response_code(422);
        render('register', ['username' => $username, 'errors' => $errors]);
        return;
    }

    login_user((int) db()->lastInsertId());
    flash('Welcome! Your account has been created.');
    redirect('/');
}

/* -------------------------------- Login --------------------------------- */

function show_login(): void
{
    if (current_user()) {
        redirect('/');
    }
    render('login', ['username' => '']);
}

function do_login(): void
{
    csrf_check();
    $username = trim((string) ($_POST['username'] ?? ''));
    $password = (string) ($_POST['password'] ?? '');

    $stmt = db()->prepare('SELECT id, password_hash FROM users WHERE username = ?');
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    // Always run a hash verification to keep timing roughly constant.
    $hash = $user['password_hash'] ?? '$2y$12$usesomesillystringforsalttoslowdownx0000000000000000000000';
    $ok = password_verify($password, $hash) && $user !== false;

    if (!$ok) {
        http_response_code(401);
        render('login', ['username' => $username, 'errors' => ['Invalid username or password.']]);
        return;
    }

    if (password_needs_rehash($user['password_hash'], defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT)) {
        $up = db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
        $up->execute([password_hash($password, defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT), $user['id']]);
    }

    login_user((int) $user['id']);
    flash('Logged in successfully.');
    redirect('/');
}

function do_logout(): void
{
    csrf_check();
    logout_user();
    redirect('/');
}

/* ----------------------------- Create post ------------------------------ */

function show_create(): void
{
    require_login();
    render('post_form', ['mode' => 'create', 'caption' => '', 'action' => '/posts/new']);
}

function do_create(): void
{
    $user = require_login();
    csrf_check();

    $caption = trim((string) ($_POST['caption'] ?? ''));
    $errors = validate_caption($caption);

    $stored = null;
    if (!$errors) {
        try {
            $stored = store_uploaded_image($_FILES['image'] ?? []);
        } catch (RuntimeException $e) {
            $errors[] = $e->getMessage();
        }
    }

    if ($errors) {
        http_response_code(422);
        render('post_form', ['mode' => 'create', 'caption' => $caption, 'action' => '/posts/new', 'errors' => $errors]);
        return;
    }

    $stmt = db()->prepare(
        'INSERT INTO posts (user_id, image_name, mime_type, caption) VALUES (?, ?, ?, ?)'
    );
    $stmt->execute([$user['id'], $stored['name'], $stored['mime'], $caption]);

    flash('Your post has been published.');
    redirect('/');
}

/* ------------------------------ Edit post ------------------------------- */

function show_edit(): void
{
    $user = require_login();
    $post = owned_post_or_abort((int) ($_GET['id'] ?? 0), $user['id']);
    render('post_form', [
        'mode'    => 'edit',
        'caption' => $post['caption'],
        'action'  => '/posts/edit?id=' . $post['id'],
        'post'    => $post,
    ]);
}

function do_edit(): void
{
    $user = require_login();
    csrf_check();
    $post = owned_post_or_abort((int) ($_GET['id'] ?? $_POST['id'] ?? 0), $user['id']);

    $caption = trim((string) ($_POST['caption'] ?? ''));
    $errors = validate_caption($caption);

    // Image replacement is optional on edit.
    $newImage = null;
    $hasUpload = isset($_FILES['image']) && ($_FILES['image']['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE;
    if (!$errors && $hasUpload) {
        try {
            $newImage = store_uploaded_image($_FILES['image']);
        } catch (RuntimeException $e) {
            $errors[] = $e->getMessage();
        }
    }

    if ($errors) {
        http_response_code(422);
        render('post_form', [
            'mode' => 'edit', 'caption' => $caption,
            'action' => '/posts/edit?id=' . $post['id'], 'post' => $post, 'errors' => $errors,
        ]);
        return;
    }

    if ($newImage !== null) {
        $stmt = db()->prepare('UPDATE posts SET caption = ?, image_name = ?, mime_type = ? WHERE id = ? AND user_id = ?');
        $stmt->execute([$caption, $newImage['name'], $newImage['mime'], $post['id'], $user['id']]);
        delete_stored_image($post['image_name']); // remove the now-orphaned old file
    } else {
        $stmt = db()->prepare('UPDATE posts SET caption = ? WHERE id = ? AND user_id = ?');
        $stmt->execute([$caption, $post['id'], $user['id']]);
    }

    flash('Your post has been updated.');
    redirect('/');
}

/* ----------------------------- Delete post ------------------------------ */

function do_delete(): void
{
    $user = require_login();
    csrf_check();
    $post = owned_post_or_abort((int) ($_POST['id'] ?? 0), $user['id']);

    $stmt = db()->prepare('DELETE FROM posts WHERE id = ? AND user_id = ?');
    $stmt->execute([$post['id'], $user['id']]);
    delete_stored_image($post['image_name']);

    flash('Your post has been deleted.');
    redirect('/');
}

/* ------------------------------ Serve image ----------------------------- */

function serve_media(int $id): void
{
    $stmt = db()->prepare('SELECT image_name, mime_type FROM posts WHERE id = ?');
    $stmt->execute([$id]);
    $post = $stmt->fetch();
    if (!$post) {
        abort(404, 'Image not found.');
    }

    $path = safe_upload_path($post['image_name']);
    if ($path === null) {
        abort(404, 'Image not found.');
    }

    // Serve as a non-executable download/inline image with a locked content type.
    $mime = isset(ALLOWED_IMAGE_TYPES[$post['mime_type']]) ? $post['mime_type'] : 'application/octet-stream';
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . (string) filesize($path));
    header('Content-Disposition: inline');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, max-age=86400');
    readfile($path);
    exit;
}

/* ===========================================================================
 * Shared helpers for handlers
 * ========================================================================= */

function validate_caption(string $caption): array
{
    if (mb_strlen($caption) > 2000) {
        return ['Caption must be 2000 characters or fewer.'];
    }
    return [];
}

/** Load a post and ensure it belongs to the given user (prevents IDOR). */
function owned_post_or_abort(int $postId, int $userId): array
{
    if ($postId <= 0) {
        abort(404, 'Post not found.');
    }
    $stmt = db()->prepare('SELECT * FROM posts WHERE id = ?');
    $stmt->execute([$postId]);
    $post = $stmt->fetch();
    if (!$post) {
        abort(404, 'Post not found.');
    }
    if ((int) $post['user_id'] !== $userId) {
        abort(403, 'You can only modify your own posts.');
    }
    return $post;
}
