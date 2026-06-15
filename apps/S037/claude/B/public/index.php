<?php

declare(strict_types=1);

namespace App;

require __DIR__ . '/../src/bootstrap.php';
require __DIR__ . '/../src/controllers.php';

$method = method();
$path   = rtrim(path(), '/');
if ($path === '') {
    $path = '/';
}

// Helper to extract a positive integer id from paths like /view/123.
$idFrom = static function (string $prefix) use ($path): ?int {
    if (!str_starts_with($path, $prefix)) {
        return null;
    }
    $rest = substr($path, strlen($prefix));
    return ctype_digit($rest) ? (int) $rest : null;
};

switch (true) {
    case $method === 'GET' && $path === '/':
        show_gallery();
        break;

    case $method === 'GET' && $path === '/register':
        show_register();
        break;
    case $method === 'POST' && $path === '/register':
        handle_register();
        break;

    case $method === 'GET' && $path === '/login':
        show_login();
        break;
    case $method === 'POST' && $path === '/login':
        handle_login();
        break;

    case $method === 'POST' && $path === '/logout':
        handle_logout();
        break;

    case $method === 'GET' && $path === '/upload':
        show_upload();
        break;
    case $method === 'POST' && $path === '/upload':
        handle_upload();
        break;

    case $method === 'POST' && $path === '/delete':
        handle_delete();
        break;

    case $method === 'GET' && ($id = $idFrom('/view/')) !== null:
        show_image_page($id);
        break;
    case $method === 'GET' && ($id = $idFrom('/image/')) !== null:
        serve_binary($id, false);
        break;
    case $method === 'GET' && ($id = $idFrom('/thumb/')) !== null:
        serve_binary($id, true);
        break;

    default:
        abort(404, 'The page you requested was not found.');
}
