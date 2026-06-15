<?php

declare(strict_types=1);

use App\Auth;
use App\Csrf;
use App\Database;

require dirname(__DIR__) . '/src/bootstrap.php';

/* ---------------------------------------------------------------------------
 * Let the PHP built-in server serve real static files (e.g. /assets/app.css)
 * directly when running via `php -S ... public/index.php`.
 * ------------------------------------------------------------------------- */
if (PHP_SAPI === 'cli-server') {
    $file = __DIR__ . parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    if (is_file($file)) {
        return false;
    }
}

$method = $_SERVER['REQUEST_METHOD'];
$path   = rtrim(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/', '/') ?: '/';

/**
 * Reject any POST that fails CSRF validation before it reaches a handler.
 */
function requireCsrf(): void
{
    if (!Csrf::validate($_POST['csrf_token'] ?? null)) {
        http_response_code(419);
        header('Content-Type: text/html; charset=utf-8');
        echo view('error', ['title' => 'Session expired', 'message' => 'Your form session expired. Please go back and try again.']);
        exit;
    }
}

function requireAuth(): void
{
    if (!Auth::check()) {
        redirect('/login');
    }
}

/* ------------------------------- Routing -------------------------------- */

$flash = $_SESSION['_flash'] ?? null;
unset($_SESSION['_flash']);

switch (true) {

    // Home: list messages newest-first + post form.
    case $method === 'GET' && $path === '/':
        $pdo = Database::connection();
        $messages = $pdo->query(
            'SELECT id, user_id, author_name, body, created_at
               FROM messages
              ORDER BY datetime(created_at) DESC, id DESC
              LIMIT 200'
        )->fetchAll();

        echo view('home', [
            'messages' => $messages,
            'flash'    => $flash,
            'old'      => $_SESSION['_old'] ?? [],
            'errors'   => $_SESSION['_errors'] ?? [],
        ]);
        unset($_SESSION['_old'], $_SESSION['_errors']);
        break;

    // Create a message.
    case $method === 'POST' && $path === '/messages':
        requireCsrf();

        $name = trim((string) ($_POST['author_name'] ?? ''));
        $body = trim((string) ($_POST['body'] ?? ''));

        $errors = [];
        if ($name === '' || mb_strlen($name) > 60) {
            $errors['author_name'] = 'Name is required and must be at most 60 characters.';
        }
        if ($body === '' || mb_strlen($body) > 2000) {
            $errors['body'] = 'Message is required and must be at most 2000 characters.';
        }
        // Reject control characters except newline/tab in the body.
        $body = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $body) ?? $body;
        $name = preg_replace('/[\x00-\x1F\x7F]/u', '', $name) ?? $name;

        if ($errors !== []) {
            $_SESSION['_errors'] = $errors;
            $_SESSION['_old'] = ['author_name' => $name, 'body' => $body];
            redirect('/');
        }

        $pdo = Database::connection();
        $stmt = $pdo->prepare(
            'INSERT INTO messages (user_id, author_name, body) VALUES (:uid, :name, :body)'
        );
        $stmt->execute([
            ':uid'  => Auth::id(),               // null for anonymous visitors
            ':name' => $name,
            ':body' => $body,
        ]);

        $_SESSION['_flash'] = 'Thanks! Your message has been posted.';
        redirect('/');

    // Delete a message — owner or admin only (access control / no IDOR).
    case $method === 'POST' && preg_match('#^/messages/(\d+)/delete$#', $path, $m) === 1:
        requireCsrf();
        requireAuth();

        $messageId = (int) $m[1];
        $pdo = Database::connection();

        $stmt = $pdo->prepare('SELECT user_id FROM messages WHERE id = :id');
        $stmt->execute([':id' => $messageId]);
        $owner = $stmt->fetch();

        if ($owner === false) {
            http_response_code(404);
            echo view('error', ['title' => 'Not found', 'message' => 'That message no longer exists.']);
            exit;
        }

        $ownsIt = $owner['user_id'] !== null && (int) $owner['user_id'] === Auth::id();
        if (!$ownsIt && !Auth::isAdmin()) {
            http_response_code(403);
            echo view('error', ['title' => 'Forbidden', 'message' => 'You can only delete your own messages.']);
            exit;
        }

        $del = $pdo->prepare('DELETE FROM messages WHERE id = :id');
        $del->execute([':id' => $messageId]);

        $_SESSION['_flash'] = 'Message deleted.';
        redirect('/');

    // Registration form.
    case $method === 'GET' && $path === '/register':
        echo view('register', ['errors' => $_SESSION['_errors'] ?? [], 'old' => $_SESSION['_old'] ?? []]);
        unset($_SESSION['_errors'], $_SESSION['_old']);
        break;

    case $method === 'POST' && $path === '/register':
        requireCsrf();

        $username = trim((string) ($_POST['username'] ?? ''));
        $password = (string) ($_POST['password'] ?? '');
        $confirm  = (string) ($_POST['password_confirm'] ?? '');

        $errors = [];
        if (!preg_match('/^[A-Za-z0-9_]{3,30}$/', $username)) {
            $errors['username'] = 'Username must be 3–30 characters: letters, numbers or underscore.';
        }
        if (strlen($password) < 8 || strlen($password) > 200) {
            $errors['password'] = 'Password must be between 8 and 200 characters.';
        }
        if ($password !== $confirm) {
            $errors['password_confirm'] = 'Passwords do not match.';
        }

        if ($errors !== []) {
            $_SESSION['_errors'] = $errors;
            $_SESSION['_old'] = ['username' => $username];
            redirect('/register');
        }

        $id = Auth::register($username, $password);
        if ($id === null) {
            $_SESSION['_errors'] = ['username' => 'That username is already taken.'];
            $_SESSION['_old'] = ['username' => $username];
            redirect('/register');
        }

        Auth::login(['id' => $id, 'username' => $username, 'is_admin' => 0]);
        $_SESSION['_flash'] = 'Welcome, ' . $username . '! Your account is ready.';
        redirect('/');

    // Login form.
    case $method === 'GET' && $path === '/login':
        echo view('login', ['errors' => $_SESSION['_errors'] ?? [], 'old' => $_SESSION['_old'] ?? []]);
        unset($_SESSION['_errors'], $_SESSION['_old']);
        break;

    case $method === 'POST' && $path === '/login':
        requireCsrf();

        $username = trim((string) ($_POST['username'] ?? ''));
        $password = (string) ($_POST['password'] ?? '');

        $user = Auth::attempt($username, $password);
        if ($user === null) {
            // Generic message — do not reveal whether the username exists.
            $_SESSION['_errors'] = ['form' => 'Invalid username or password.'];
            $_SESSION['_old'] = ['username' => $username];
            redirect('/login');
        }

        Auth::login($user);
        $_SESSION['_flash'] = 'Signed in as ' . $user['username'] . '.';
        redirect('/');

    case $method === 'POST' && $path === '/logout':
        requireCsrf();
        Auth::logout();
        redirect('/');

    default:
        http_response_code(404);
        echo view('error', ['title' => 'Not found', 'message' => 'The page you requested does not exist.']);
        break;
}
