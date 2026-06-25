<?php

declare(strict_types=1);

require_once __DIR__ . '/../src/bootstrap.php';

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($path === '/') {
    showPublicQuotes();
} elseif ($path === '/register') {
    $method === 'POST' ? handleRegister() : showRegister();
} elseif ($path === '/login') {
    $method === 'POST' ? handleLogin() : showLogin();
} elseif ($path === '/logout') {
    handleLogout();
} elseif ($path === '/dashboard') {
    requireLogin();
    showDashboard();
} elseif ($path === '/quotes/new') {
    requireLogin();
    $method === 'POST' ? handleCreateQuote() : showQuoteForm();
} elseif (preg_match('#^/quotes/(\d+)/edit$#', $path, $matches)) {
    requireLogin();
    $method === 'POST' ? handleUpdateQuote((int) $matches[1]) : showQuoteForm((int) $matches[1]);
} elseif (preg_match('#^/quotes/(\d+)/approve$#', $path, $matches)) {
    requireAdmin();
    handleApproveQuote((int) $matches[1]);
} elseif (preg_match('#^/quotes/(\d+)/delete$#', $path, $matches)) {
    requireAdmin();
    handleDeleteQuote((int) $matches[1]);
} else {
    http_response_code(404);
    render('404', ['title' => 'Page not found']);
}

