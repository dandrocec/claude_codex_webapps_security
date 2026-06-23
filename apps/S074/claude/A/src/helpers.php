<?php

declare(strict_types=1);

/* ----------------------------------------------------------------------------
 * Output / request helpers
 * ------------------------------------------------------------------------- */

/** Escape a value for safe HTML output. */
function e(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

/** Format an integer amount of cents as a currency string. */
function money(int $cents): string
{
    return '$' . number_format($cents / 100, 2);
}

/** Send a redirect and stop execution. */
function redirect(string $path): void
{
    header('Location: ' . $path);
    exit;
}

/** Read a trimmed POST string. */
function post(string $key, string $default = ''): string
{
    return isset($_POST[$key]) ? trim((string) $_POST[$key]) : $default;
}

/* ----------------------------------------------------------------------------
 * Flash messages (one-shot notifications stored in the session)
 * ------------------------------------------------------------------------- */

function flash(string $message, string $type = 'success'): void
{
    $_SESSION['flash'][] = ['message' => $message, 'type' => $type];
}

function take_flashes(): array
{
    $flashes = $_SESSION['flash'] ?? [];
    unset($_SESSION['flash']);
    return $flashes;
}

/* ----------------------------------------------------------------------------
 * CSRF protection
 * ------------------------------------------------------------------------- */

function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function csrf_field(): string
{
    return '<input type="hidden" name="csrf" value="' . e(csrf_token()) . '">';
}

/** Abort with 419 if the submitted CSRF token is missing or wrong. */
function csrf_check(): void
{
    $token = $_POST['csrf'] ?? '';
    if (!is_string($token) || !hash_equals(csrf_token(), $token)) {
        http_response_code(419);
        exit('Invalid CSRF token. Please go back and try again.');
    }
}

/* ----------------------------------------------------------------------------
 * Authentication / authorization
 * ------------------------------------------------------------------------- */

/** The currently logged-in user row, or null. */
function current_user(): ?array
{
    static $cache = false;
    if ($cache !== false) {
        return $cache;
    }
    $id = $_SESSION['user_id'] ?? null;
    if (!$id) {
        return $cache = null;
    }
    $stmt = db()->prepare('SELECT * FROM users WHERE id = ?');
    $stmt->execute([$id]);
    $user = $stmt->fetch();
    return $cache = ($user ?: null);
}

function require_login(): array
{
    $user = current_user();
    if (!$user) {
        flash('Please log in to continue.', 'error');
        redirect('/login');
    }
    return $user;
}

/** Require a logged-in user with a specific role ('vendor' or 'buyer'). */
function require_role(string $role): array
{
    $user = require_login();
    if ($user['role'] !== $role) {
        http_response_code(403);
        render('error', ['title' => 'Forbidden',
            'message' => 'This area is only available to ' . $role . 's.']);
        exit;
    }
    return $user;
}

/* ----------------------------------------------------------------------------
 * Cart (stored in the session as product_id => quantity)
 * ------------------------------------------------------------------------- */

function cart(): array
{
    return $_SESSION['cart'] ?? [];
}

function cart_count(): int
{
    return array_sum(cart());
}

/**
 * Loads cart contents joined with live product data.
 * Returns [items[], total_cents]. Items reference current product rows so
 * unavailable products are skipped automatically.
 */
function cart_detailed(): array
{
    $cart = cart();
    if (!$cart) {
        return [[], 0];
    }

    $ids = array_keys($cart);
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $stmt = db()->prepare(
        "SELECT p.*, u.shop_name, u.name AS vendor_name
         FROM products p JOIN users u ON u.id = p.vendor_id
         WHERE p.id IN ($placeholders)"
    );
    $stmt->execute($ids);

    $items = [];
    $total = 0;
    foreach ($stmt->fetchAll() as $product) {
        $qty = (int) $cart[$product['id']];
        $qty = max(1, min($qty, (int) $product['stock'] ?: $qty));
        $lineTotal = $qty * (int) $product['price_cents'];
        $total += $lineTotal;
        $items[] = [
            'product'    => $product,
            'quantity'   => $qty,
            'line_total' => $lineTotal,
        ];
    }
    return [$items, $total];
}

/* ----------------------------------------------------------------------------
 * View rendering
 * ------------------------------------------------------------------------- */

/**
 * Renders a view file from /views wrapped in the shared layout.
 * $data is extracted into the view's local scope.
 */
function render(string $view, array $data = []): void
{
    extract($data, EXTR_SKIP);
    $viewFile = dirname(__DIR__) . '/views/' . $view . '.php';

    ob_start();
    require $viewFile;
    $content = ob_get_clean();

    $user    = current_user();
    $flashes = take_flashes();
    require dirname(__DIR__) . '/views/layout.php';
}
