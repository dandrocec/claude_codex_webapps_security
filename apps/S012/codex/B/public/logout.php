<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    render_error('Method not allowed.');
}

if (!csrf_verify($_POST['csrf_token'] ?? '')) {
    http_response_code(403);
    render_error('The form expired. Please go back and try again.');
}

$_SESSION = [];
if (ini_get('session.use_cookies')) {
    $params = session_get_cookie_params();
    setcookie(session_name(), '', [
        'expires' => time() - 42000,
        'path' => $params['path'],
        'domain' => $params['domain'],
        'secure' => $params['secure'],
        'httponly' => $params['httponly'],
        'samesite' => $params['samesite'] ?? 'Lax',
    ]);
}
session_destroy();

header('Location: /login.php', true, 303);
exit;
