<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

$action = $_GET['action'] ?? (current_user() ? 'contacts' : 'login');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    match ($action) {
        'register' => handle_register($method),
        'login' => handle_login($method),
        'logout' => handle_logout($method),
        'contacts' => handle_contacts(),
        'create' => handle_create($method),
        'edit' => handle_edit($method),
        'delete' => handle_delete($method),
        default => not_found(),
    };
} catch (Throwable $e) {
    error_log($e->getMessage());
    http_response_code(500);
    render('Error', '<p class="error">Something went wrong. Please try again.</p>');
}
