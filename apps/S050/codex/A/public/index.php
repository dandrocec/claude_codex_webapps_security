<?php
declare(strict_types=1);

session_start();

const BASE_PATH = __DIR__ . '/..';
const DATA_PATH = BASE_PATH . '/data';
const UPLOAD_PATH = __DIR__ . '/uploads';
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

ensureDirectory(DATA_PATH);
ensureDirectory(UPLOAD_PATH);

$pdo = new PDO('sqlite:' . DATA_PATH . '/blog.sqlite', null, null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);

initializeDatabase($pdo);

$route = $_GET['action'] ?? 'feed';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$errors = [];

if ($method === 'POST' && !verifyCsrf($_POST['csrf'] ?? '')) {
    http_response_code(400);
    renderPage('Bad request', '<section class="panel"><h1>Bad request</h1><p>Your session token expired. Go back and try again.</p></section>');
    exit;
}

try {
    if ($route === 'register') {
        if ($method === 'POST') {
            $username = trim((string)($_POST['username'] ?? ''));
            $password = (string)($_POST['password'] ?? '');

            if ($username === '' || strlen($username) > 40) {
                $errors[] = 'Choose a username between 1 and 40 characters.';
            }
            if (strlen($password) < 8) {
                $errors[] = 'Use a password with at least 8 characters.';
            }

            if (!$errors) {
                $stmt = $pdo->prepare('INSERT INTO users (username, password_hash, created_at) VALUES (:username, :hash, :created_at)');
                $stmt->execute([
                    ':username' => $username,
                    ':hash' => password_hash($password, PASSWORD_DEFAULT),
                    ':created_at' => now(),
                ]);
                $_SESSION['user_id'] = (int)$pdo->lastInsertId();
                redirect('/');
            }
        }

        renderPage('Register', authForm('Create account', 'register', $errors));
        exit;
    }

    if ($route === 'login') {
        if ($method === 'POST') {
            $username = trim((string)($_POST['username'] ?? ''));
            $password = (string)($_POST['password'] ?? '');
            $stmt = $pdo->prepare('SELECT * FROM users WHERE username = :username');
            $stmt->execute([':username' => $username]);
            $user = $stmt->fetch();

            if ($user && password_verify($password, $user['password_hash'])) {
                session_regenerate_id(true);
                $_SESSION['user_id'] = (int)$user['id'];
                redirect('/');
            }
            $errors[] = 'Invalid username or password.';
        }

        renderPage('Log in', authForm('Log in', 'login', $errors));
        exit;
    }

    if ($route === 'logout' && $method === 'POST') {
        $_SESSION = [];
        session_destroy();
        redirect('/');
    }

    if ($route === 'new') {
        requireLogin();
        if ($method === 'POST') {
            $caption = trim((string)($_POST['caption'] ?? ''));
            $image = handleUpload('image', $errors);
            if ($caption === '' || strlen($caption) > 500) {
                $errors[] = 'Write a caption between 1 and 500 characters.';
            }

            if (!$errors && $image !== null) {
                $stmt = $pdo->prepare(
                    'INSERT INTO posts (user_id, image_path, caption, created_at, updated_at)
                     VALUES (:user_id, :image_path, :caption, :created_at, :updated_at)'
                );
                $timestamp = now();
                $stmt->execute([
                    ':user_id' => currentUserId(),
                    ':image_path' => $image,
                    ':caption' => $caption,
                    ':created_at' => $timestamp,
                    ':updated_at' => $timestamp,
                ]);
                redirect('/');
            }
        }

        renderPage('New post', postForm('Publish photo', 'new', '', true, $errors));
        exit;
    }

    if ($route === 'edit') {
        requireLogin();
        $post = findOwnedPost($pdo, (int)($_GET['id'] ?? 0));

        if ($method === 'POST') {
            $caption = trim((string)($_POST['caption'] ?? ''));
            if ($caption === '' || strlen($caption) > 500) {
                $errors[] = 'Write a caption between 1 and 500 characters.';
            }
            if (!$errors) {
                $stmt = $pdo->prepare('UPDATE posts SET caption = :caption, updated_at = :updated_at WHERE id = :id AND user_id = :user_id');
                $stmt->execute([
                    ':caption' => $caption,
                    ':updated_at' => now(),
                    ':id' => $post['id'],
                    ':user_id' => currentUserId(),
                ]);
                redirect('/');
            }
            $post['caption'] = $caption;
        }

        renderPage('Edit post', postForm('Edit caption', 'edit&id=' . (int)$post['id'], $post['caption'], false, $errors));
        exit;
    }

    if ($route === 'delete' && $method === 'POST') {
        requireLogin();
        $post = findOwnedPost($pdo, (int)($_POST['id'] ?? 0));
        $stmt = $pdo->prepare('DELETE FROM posts WHERE id = :id AND user_id = :user_id');
        $stmt->execute([':id' => $post['id'], ':user_id' => currentUserId()]);

        $fullPath = UPLOAD_PATH . '/' . basename((string)$post['image_path']);
        if (is_file($fullPath)) {
            unlink($fullPath);
        }
        redirect('/');
    }

    renderPage('Photo Blog', feed($pdo));
} catch (PDOException $e) {
    if (str_contains($e->getMessage(), 'UNIQUE')) {
        renderPage('Account exists', authForm('Create account', 'register', ['That username is already taken.']));
        exit;
    }
    throw $e;
}

function initializeDatabase(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        )'
    );
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            image_path TEXT NOT NULL,
            caption TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )'
    );
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC)');
}

function feed(PDO $pdo): string
{
    $stmt = $pdo->query(
        'SELECT posts.*, users.username
         FROM posts
         JOIN users ON users.id = posts.user_id
         ORDER BY posts.created_at DESC'
    );
    $posts = $stmt->fetchAll();

    $html = '<section class="topline"><div><h1>Photo Blog</h1><p>Recent photos from the community.</p></div>';
    if (isLoggedIn()) {
        $html .= '<a class="button primary" href="/?action=new">New post</a>';
    }
    $html .= '</section>';

    if (!$posts) {
        return $html . '<section class="empty"><h2>No posts yet</h2><p>Create an account, sign in, and publish the first photo.</p></section>';
    }

    $html .= '<section class="feed">';
    foreach ($posts as $post) {
        $isOwner = isLoggedIn() && (int)$post['user_id'] === currentUserId();
        $html .= '<article class="post">';
        $html .= '<img src="/uploads/' . e($post['image_path']) . '" alt="">';
        $html .= '<div class="post-body">';
        $html .= '<p class="caption">' . nl2br(e($post['caption'])) . '</p>';
        $html .= '<div class="meta">By ' . e($post['username']) . ' on ' . e(formatDate($post['created_at'])) . '</div>';
        if ($isOwner) {
            $html .= '<div class="actions"><a class="button" href="/?action=edit&id=' . (int)$post['id'] . '">Edit</a>';
            $html .= '<form method="post" action="/?action=delete" onsubmit="return confirm(\'Delete this post?\')">';
            $html .= '<input type="hidden" name="csrf" value="' . e(csrfToken()) . '">';
            $html .= '<input type="hidden" name="id" value="' . (int)$post['id'] . '">';
            $html .= '<button class="button danger" type="submit">Delete</button></form></div>';
        }
        $html .= '</div></article>';
    }
    return $html . '</section>';
}

function authForm(string $title, string $action, array $errors): string
{
    return '<section class="panel narrow"><h1>' . e($title) . '</h1>' . errorList($errors) .
        '<form method="post" action="/?action=' . e($action) . '">' .
        '<input type="hidden" name="csrf" value="' . e(csrfToken()) . '">' .
        '<label>Username<input name="username" autocomplete="username" required maxlength="40"></label>' .
        '<label>Password<input name="password" type="password" autocomplete="' . ($action === 'login' ? 'current-password' : 'new-password') . '" required minlength="8"></label>' .
        '<button class="button primary" type="submit">' . e($title) . '</button>' .
        '</form></section>';
}

function postForm(string $title, string $action, string $caption, bool $needsImage, array $errors): string
{
    $imageInput = $needsImage
        ? '<label>Image<input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" required></label>'
        : '';

    return '<section class="panel"><h1>' . e($title) . '</h1>' . errorList($errors) .
        '<form method="post" action="/?action=' . e($action) . '" enctype="multipart/form-data">' .
        '<input type="hidden" name="csrf" value="' . e(csrfToken()) . '">' .
        $imageInput .
        '<label>Caption<textarea name="caption" rows="5" maxlength="500" required>' . e($caption) . '</textarea></label>' .
        '<div class="actions"><button class="button primary" type="submit">' . e($title) . '</button><a class="button" href="/">Cancel</a></div>' .
        '</form></section>';
}

function handleUpload(string $field, array &$errors): ?string
{
    if (!isset($_FILES[$field]) || !is_array($_FILES[$field])) {
        $errors[] = 'Choose an image to upload.';
        return null;
    }

    $file = $_FILES[$field];
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        $errors[] = 'The image could not be uploaded.';
        return null;
    }
    if (($file['size'] ?? 0) > MAX_UPLOAD_BYTES) {
        $errors[] = 'Images must be 5 MB or smaller.';
        return null;
    }

    $tmpName = (string)$file['tmp_name'];
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($tmpName);
    $extensions = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
        'image/gif' => 'gif',
    ];
    if (!isset($extensions[$mime])) {
        $errors[] = 'Upload a JPEG, PNG, WebP, or GIF image.';
        return null;
    }

    $filename = bin2hex(random_bytes(16)) . '.' . $extensions[$mime];
    if (!move_uploaded_file($tmpName, UPLOAD_PATH . '/' . $filename)) {
        $errors[] = 'The image could not be saved.';
        return null;
    }
    return $filename;
}

function findOwnedPost(PDO $pdo, int $id): array
{
    $stmt = $pdo->prepare('SELECT * FROM posts WHERE id = :id AND user_id = :user_id');
    $stmt->execute([':id' => $id, ':user_id' => currentUserId()]);
    $post = $stmt->fetch();
    if (!$post) {
        http_response_code(404);
        renderPage('Not found', '<section class="panel"><h1>Post not found</h1><p>This post does not exist or is not yours.</p></section>');
        exit;
    }
    return $post;
}

function renderPage(string $title, string $content): void
{
    $user = currentUser();
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8">';
    echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
    echo '<title>' . e($title) . '</title><link rel="stylesheet" href="/styles.css"></head><body>';
    echo '<header class="site-header"><a class="brand" href="/">Photo Blog</a><nav>';
    if ($user) {
        echo '<span class="user">' . e($user['username']) . '</span>';
        echo '<form method="post" action="/?action=logout"><input type="hidden" name="csrf" value="' . e(csrfToken()) . '"><button type="submit">Log out</button></form>';
    } else {
        echo '<a href="/?action=login">Log in</a><a href="/?action=register">Register</a>';
    }
    echo '</nav></header><main>' . $content . '</main></body></html>';
}

function currentUser(): ?array
{
    static $cached = false;
    static $user = null;
    global $pdo;

    if ($cached) {
        return $user;
    }
    $cached = true;
    if (!isset($_SESSION['user_id'])) {
        return null;
    }
    $stmt = $pdo->prepare('SELECT id, username FROM users WHERE id = :id');
    $stmt->execute([':id' => (int)$_SESSION['user_id']]);
    $user = $stmt->fetch() ?: null;
    return $user;
}

function currentUserId(): int
{
    return (int)($_SESSION['user_id'] ?? 0);
}

function isLoggedIn(): bool
{
    return currentUser() !== null;
}

function requireLogin(): void
{
    if (!isLoggedIn()) {
        redirect('/?action=login');
    }
}

function csrfToken(): string
{
    if (!isset($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return (string)$_SESSION['csrf'];
}

function verifyCsrf(string $token): bool
{
    return isset($_SESSION['csrf']) && hash_equals((string)$_SESSION['csrf'], $token);
}

function errorList(array $errors): string
{
    if (!$errors) {
        return '';
    }
    $items = array_map(fn (string $error): string => '<li>' . e($error) . '</li>', $errors);
    return '<ul class="errors">' . implode('', $items) . '</ul>';
}

function ensureDirectory(string $path): void
{
    if (!is_dir($path)) {
        mkdir($path, 0775, true);
    }
}

function redirect(string $path): void
{
    header('Location: ' . $path, true, 302);
    exit;
}

function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function now(): string
{
    return gmdate('Y-m-d H:i:s');
}

function formatDate(string $value): string
{
    return date('M j, Y g:i A', strtotime($value . ' UTC'));
}
