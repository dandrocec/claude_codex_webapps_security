<?php
declare(strict_types=1);

/**
 * CSRF protection. A per-session token is required on every state-changing
 * (POST) request and compared in constant time.
 */
function csrf_token(): string
{
    if (empty($_SESSION['_csrf'])) {
        $_SESSION['_csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['_csrf'];
}

/** Hidden input to embed in every form. */
function csrf_field(): string
{
    return '<input type="hidden" name="_csrf" value="' . e(csrf_token()) . '">';
}

function csrf_validate(): bool
{
    $sent = $_POST['_csrf'] ?? '';
    return is_string($sent)
        && !empty($_SESSION['_csrf'])
        && hash_equals($_SESSION['_csrf'], $sent);
}

/** Abort the request with 419 if the CSRF token is missing/invalid. */
function require_csrf(): void
{
    if (!csrf_validate()) {
        http_response_code(419);
        view('error', ['message' => 'Your session expired or the request could not be verified. Please go back and try again.'], 'Request not verified');
        exit;
    }
}
