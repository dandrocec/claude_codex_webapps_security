<?php

declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
$path = '/' . trim($path, '/');
if ($path === '/') {
    $path = '/';
}

/* All POST routes require a valid CSRF token. */
if ($method === 'POST' && !csrf_validate($_POST['csrf_token'] ?? null)) {
    http_response_code(400);
    flash_set('error', 'Your session expired or the request was invalid. Please try again.');
    redirect('/');
}

switch ("$method $path") {
    case 'GET /':
        render('subscribe', [
            'title'   => 'Subscribe',
            'success' => flash_get('success'),
            'error'   => flash_get('error'),
            'old'     => flash_get('old_email') ?? '',
        ]);
        break;

    case 'POST /subscribe':
        handle_subscribe();
        break;

    case 'GET /admin/login':
        if (is_admin()) {
            redirect('/admin/subscribers');
        }
        render('login', [
            'title' => 'Admin sign in',
            'error' => flash_get('error'),
        ]);
        break;

    case 'POST /admin/login':
        handle_login();
        break;

    case 'POST /admin/logout':
        handle_logout();
        break;

    case 'GET /admin/subscribers':
        require_admin();
        $rows = db()->query('SELECT email, created_at FROM subscribers ORDER BY created_at DESC, id DESC')->fetchAll();
        render('subscribers', [
            'title'       => 'Subscribers',
            'subscribers' => $rows,
        ]);
        break;

    default:
        http_response_code(404);
        render('error', ['title' => 'Not found', 'code' => 404, 'message' => 'Page not found.']);
        break;
}

/* ---------------------------------------------------------------------- */

function handle_subscribe(): void
{
    $raw = (string) ($_POST['email'] ?? '');
    $email = strtolower(trim($raw));

    // Validate & sanitise input.
    if ($email === '' || strlen($email) > 254 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        flash_set('error', 'Please enter a valid email address.');
        flash_set('old_email', $raw);
        redirect('/');
    }

    // Parameterised query prevents SQL injection.
    $stmt = db()->prepare('INSERT OR IGNORE INTO subscribers (email) VALUES (:email)');
    $stmt->execute([':email' => $email]);

    if ($stmt->rowCount() === 0) {
        flash_set('success', 'You are already subscribed with ' . $email . '. Thanks!');
    } else {
        flash_set('success', 'Thanks! ' . $email . ' has been subscribed.');
    }
    redirect('/');
}

function handle_login(): void
{
    $username = trim((string) ($_POST['username'] ?? ''));
    $password = (string) ($_POST['password'] ?? '');

    $expectedUser = (string) env('ADMIN_USERNAME', '');
    $expectedHash = (string) env('ADMIN_PASSWORD_HASH', '');

    $userOk = $expectedUser !== '' && hash_equals($expectedUser, $username);
    // password_verify checks the salted bcrypt/argon2 hash in constant time.
    $passOk = $expectedHash !== '' && password_verify($password, $expectedHash);

    if (!$userOk || !$passOk) {
        // Generic message — do not reveal which field was wrong.
        error_log('[auth] failed admin login attempt for user "' . $username . '"');
        flash_set('error', 'Invalid credentials.');
        redirect('/admin/login');
    }

    // Prevent session fixation.
    session_regenerate_id(true);
    $_SESSION['admin'] = true;
    redirect('/admin/subscribers');
}

function handle_logout(): void
{
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires'  => time() - 42000,
            'path'     => $p['path'],
            'domain'   => $p['domain'],
            'secure'   => $p['secure'],
            'httponly' => $p['httponly'],
            'samesite' => $p['samesite'],
        ]);
    }
    session_destroy();
    redirect('/');
}
