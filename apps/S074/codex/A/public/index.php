<?php

declare(strict_types=1);

session_start();

require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/Auth.php';

$db = new Database(__DIR__ . '/../data/marketplace.sqlite');
$pdo = $db->pdo();
$auth = new Auth($pdo);
$user = $auth->user();
$action = $_GET['action'] ?? 'home';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$flash = $_SESSION['flash'] ?? null;
unset($_SESSION['flash']);

function redirect(string $path): never
{
    header('Location: ' . $path);
    exit;
}

function money(int $cents): string
{
    return '$' . number_format($cents / 100, 2);
}

function h(?string $value): string
{
    return htmlspecialchars($value ?? '', ENT_QUOTES, 'UTF-8');
}

function cartCount(): int
{
    return array_sum(array_map('intval', $_SESSION['cart'] ?? []));
}

function requireUser(?array $user): array
{
    if (!$user) {
        $_SESSION['flash'] = 'Please sign in first.';
        redirect('/?action=login');
    }

    return $user;
}

function requireRole(?array $user, string $role): array
{
    $user = requireUser($user);
    if ($user['role'] !== $role) {
        http_response_code(403);
        render('Forbidden', '<p>You do not have access to this area.</p>');
        exit;
    }

    return $user;
}

function post(string $key, string $default = ''): string
{
    return trim((string) ($_POST[$key] ?? $default));
}

function render(string $title, string $body): void
{
    global $user, $flash;
    $cartCount = cartCount();
    $nav = $user
        ? '<span>' . h($user['name']) . ' (' . h($user['role']) . ')</span><a href="/?action=logout">Sign out</a>'
        : '<a href="/?action=login">Sign in</a><a href="/?action=register">Register</a>';
    $vendorLink = $user && $user['role'] === 'vendor' ? '<a href="/?action=vendor">Vendor dashboard</a>' : '';
    $ordersLink = $user && $user['role'] === 'buyer' ? '<a href="/?action=my_orders">My orders</a>' : '';
    $flashHtml = $flash ? '<div class="flash">' . h($flash) . '</div>' : '';

    echo '<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>' . h($title) . '</title>
  <style>
    :root { color-scheme: light; --ink:#1e293b; --muted:#64748b; --line:#d8dee8; --panel:#ffffff; --bg:#f6f7f9; --accent:#0f766e; --accent2:#9a3412; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: var(--bg); color: var(--ink); }
    header { background: #ffffff; border-bottom: 1px solid var(--line); }
    .bar, main { width: min(1120px, calc(100% - 32px)); margin: 0 auto; }
    .bar { min-height: 64px; display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
    .brand { font-weight: 800; font-size: 20px; color: var(--accent); text-decoration: none; }
    nav { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    a { color: var(--accent); }
    nav a { text-decoration: none; font-weight: 700; }
    main { padding: 28px 0 48px; }
    h1 { margin: 0 0 18px; font-size: 30px; }
    h2 { margin: 28px 0 12px; font-size: 21px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 16px; }
    .card, .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px; }
    .card h2 { margin-top: 0; }
    .muted { color: var(--muted); }
    .price { font-size: 22px; font-weight: 800; margin: 14px 0; }
    button, .button { border: 0; border-radius: 7px; background: var(--accent); color: #fff; padding: 10px 13px; font-weight: 800; cursor: pointer; text-decoration: none; display: inline-block; }
    button.secondary, .button.secondary { background: var(--accent2); }
    input, textarea, select { width: 100%; padding: 10px; border: 1px solid var(--line); border-radius: 7px; font: inherit; background: #fff; }
    label { display: block; margin: 12px 0 6px; font-weight: 700; }
    form.inline { display: inline; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--line); }
    th, td { padding: 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { background: #eef2f7; }
    .flash { margin-bottom: 18px; padding: 12px 14px; border-radius: 7px; background: #dff5ef; border: 1px solid #95d5c5; }
    .actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .split { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: start; }
    @media (max-width: 760px) { .split { grid-template-columns: 1fr; } .bar { align-items: flex-start; padding: 14px 0; } }
  </style>
</head>
<body>
  <header><div class="bar"><a class="brand" href="/">MarketHub</a><nav><a href="/">Shop</a><a href="/?action=cart">Cart (' . $cartCount . ')</a>' . $ordersLink . $vendorLink . $nav . '</nav></div></header>
  <main>' . $flashHtml . $body . '</main>
</body>
</html>';
}

if ($method === 'POST' && $action === 'login') {
    if ($auth->login(post('email'), post('password'))) {
        redirect('/');
    }
    $flash = 'Invalid email or password.';
}

if ($method === 'POST' && $action === 'register') {
    [$ok, $message] = $auth->register(post('name'), post('email'), post('password'), post('role'));
    if ($ok) {
        redirect('/');
    }
    $flash = $message;
}

if ($action === 'logout') {
    $auth->logout();
    redirect('/');
}

if ($method === 'POST' && $action === 'add_to_cart') {
    requireRole($user, 'buyer');
    $productId = (int) ($_POST['product_id'] ?? 0);
    $quantity = max(1, (int) ($_POST['quantity'] ?? 1));
    $stmt = $pdo->prepare('SELECT id, stock FROM products WHERE id = ? AND active = 1');
    $stmt->execute([$productId]);
    $product = $stmt->fetch();
    if ($product) {
        $_SESSION['cart'][$productId] = min((int) $product['stock'], (int) ($_SESSION['cart'][$productId] ?? 0) + $quantity);
        $_SESSION['flash'] = 'Added to cart.';
    }
    redirect('/?action=cart');
}

if ($method === 'POST' && $action === 'update_cart') {
    requireRole($user, 'buyer');
    foreach ($_POST['quantities'] ?? [] as $productId => $quantity) {
        $quantity = max(0, (int) $quantity);
        if ($quantity === 0) {
            unset($_SESSION['cart'][(int) $productId]);
        } else {
            $_SESSION['cart'][(int) $productId] = $quantity;
        }
    }
    redirect('/?action=cart');
}

if ($method === 'POST' && $action === 'checkout') {
    $buyer = requireRole($user, 'buyer');
    $cart = $_SESSION['cart'] ?? [];
    if (!$cart) {
        $_SESSION['flash'] = 'Your cart is empty.';
        redirect('/?action=cart');
    }

    $pdo->beginTransaction();
    try {
        $ids = array_map('intval', array_keys($cart));
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $pdo->prepare("SELECT * FROM products WHERE active = 1 AND id IN ($placeholders)");
        $stmt->execute($ids);
        $products = [];
        foreach ($stmt->fetchAll() as $product) {
            $products[(int) $product['id']] = $product;
        }

        $lines = [];
        $total = 0;
        foreach ($cart as $productId => $quantity) {
            $productId = (int) $productId;
            if (!isset($products[$productId])) {
                continue;
            }
            $quantity = min((int) $quantity, (int) $products[$productId]['stock']);
            if ($quantity < 1) {
                continue;
            }
            $lineTotal = $quantity * (int) $products[$productId]['price_cents'];
            $total += $lineTotal;
            $lines[] = [$products[$productId], $quantity, $lineTotal];
        }

        if (!$lines) {
            throw new RuntimeException('No available products remain in the cart.');
        }

        $stmt = $pdo->prepare('INSERT INTO orders (buyer_id, total_cents) VALUES (?, ?)');
        $stmt->execute([(int) $buyer['id'], $total]);
        $orderId = (int) $pdo->lastInsertId();

        $itemStmt = $pdo->prepare(
            'INSERT INTO order_items (order_id, product_id, vendor_id, product_name, quantity, unit_price_cents, line_total_cents) VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        $stockStmt = $pdo->prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND vendor_id = ?');
        foreach ($lines as [$product, $quantity, $lineTotal]) {
            $itemStmt->execute([
                $orderId,
                (int) $product['id'],
                (int) $product['vendor_id'],
                $product['name'],
                $quantity,
                (int) $product['price_cents'],
                $lineTotal,
            ]);
            $stockStmt->execute([$quantity, (int) $product['id'], (int) $product['vendor_id']]);
        }

        $pdo->commit();
        unset($_SESSION['cart']);
        $_SESSION['flash'] = 'Order placed.';
        redirect('/?action=my_orders');
    } catch (Throwable $e) {
        $pdo->rollBack();
        $_SESSION['flash'] = $e->getMessage();
        redirect('/?action=cart');
    }
}

if ($method === 'POST' && $action === 'save_product') {
    $vendor = requireRole($user, 'vendor');
    $id = (int) ($_POST['id'] ?? 0);
    $name = post('name');
    $description = post('description');
    $priceCents = max(0, (int) round((float) post('price') * 100));
    $stock = max(0, (int) post('stock'));
    $active = isset($_POST['active']) ? 1 : 0;

    if ($name === '') {
        $_SESSION['flash'] = 'Product name is required.';
        redirect('/?action=vendor');
    }

    if ($id > 0) {
        $stmt = $pdo->prepare(
            'UPDATE products SET name = ?, description = ?, price_cents = ?, stock = ?, active = ? WHERE id = ? AND vendor_id = ?'
        );
        $stmt->execute([$name, $description, $priceCents, $stock, $active, $id, (int) $vendor['id']]);
    } else {
        $stmt = $pdo->prepare(
            'INSERT INTO products (vendor_id, name, description, price_cents, stock, active) VALUES (?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([(int) $vendor['id'], $name, $description, $priceCents, $stock, $active]);
    }

    $_SESSION['flash'] = 'Product saved.';
    redirect('/?action=vendor');
}

if ($method === 'POST' && $action === 'delete_product') {
    $vendor = requireRole($user, 'vendor');
    $stmt = $pdo->prepare('DELETE FROM products WHERE id = ? AND vendor_id = ?');
    $stmt->execute([(int) ($_POST['id'] ?? 0), (int) $vendor['id']]);
    $_SESSION['flash'] = 'Product deleted.';
    redirect('/?action=vendor');
}

if ($action === 'login') {
    render('Sign in', '<div class="panel"><h1>Sign in</h1><form method="post" action="/?action=login"><label>Email</label><input name="email" type="email" required><label>Password</label><input name="password" type="password" required><p><button>Sign in</button></p></form></div>');
    exit;
}

if ($action === 'register') {
    render('Register', '<div class="panel"><h1>Register</h1><form method="post" action="/?action=register"><label>Name</label><input name="name" required><label>Email</label><input name="email" type="email" required><label>Password</label><input name="password" type="password" minlength="6" required><label>Account type</label><select name="role"><option value="buyer">Buyer</option><option value="vendor">Vendor</option></select><p><button>Create account</button></p></form></div>');
    exit;
}

if ($action === 'cart') {
    requireRole($user, 'buyer');
    $cart = $_SESSION['cart'] ?? [];
    $rows = '';
    $total = 0;
    if ($cart) {
        $ids = array_map('intval', array_keys($cart));
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $pdo->prepare("SELECT p.*, u.name AS vendor_name FROM products p JOIN users u ON u.id = p.vendor_id WHERE p.id IN ($placeholders)");
        $stmt->execute($ids);
        foreach ($stmt->fetchAll() as $product) {
            $quantity = min((int) ($cart[(int) $product['id']] ?? 0), (int) $product['stock']);
            $line = $quantity * (int) $product['price_cents'];
            $total += $line;
            $rows .= '<tr><td>' . h($product['name']) . '<br><span class="muted">' . h($product['vendor_name']) . '</span></td><td>' . money((int) $product['price_cents']) . '</td><td><input name="quantities[' . (int) $product['id'] . ']" type="number" min="0" max="' . (int) $product['stock'] . '" value="' . $quantity . '"></td><td>' . money($line) . '</td></tr>';
        }
    }
    $body = '<h1>Cart</h1>';
    if ($rows === '') {
        $body .= '<div class="panel"><p>Your cart is empty.</p><a class="button" href="/">Continue shopping</a></div>';
    } else {
        $body .= '<form method="post" action="/?action=update_cart"><table><thead><tr><th>Product</th><th>Price</th><th>Quantity</th><th>Total</th></tr></thead><tbody>' . $rows . '</tbody><tfoot><tr><th colspan="3">Cart total</th><th>' . money($total) . '</th></tr></tfoot></table><p class="actions"><button>Update cart</button></form><form class="inline" method="post" action="/?action=checkout"><button class="secondary">Place order</button></form></p>';
    }
    render('Cart', $body);
    exit;
}

if ($action === 'my_orders') {
    $buyer = requireRole($user, 'buyer');
    $stmt = $pdo->prepare('SELECT * FROM orders WHERE buyer_id = ? ORDER BY created_at DESC, id DESC');
    $stmt->execute([(int) $buyer['id']]);
    $body = '<h1>My orders</h1>';
    foreach ($stmt->fetchAll() as $order) {
        $items = $pdo->prepare('SELECT oi.*, u.name AS vendor_name FROM order_items oi JOIN users u ON u.id = oi.vendor_id WHERE oi.order_id = ? ORDER BY oi.id');
        $items->execute([(int) $order['id']]);
        $rows = '';
        foreach ($items->fetchAll() as $item) {
            $rows .= '<tr><td>' . h($item['product_name']) . '</td><td>' . h($item['vendor_name']) . '</td><td>' . (int) $item['quantity'] . '</td><td>' . money((int) $item['line_total_cents']) . '</td></tr>';
        }
        $body .= '<section class="panel"><h2>Order #' . (int) $order['id'] . ' - ' . money((int) $order['total_cents']) . '</h2><p class="muted">' . h($order['created_at']) . '</p><table><tr><th>Product</th><th>Vendor</th><th>Qty</th><th>Total</th></tr>' . $rows . '</table></section>';
    }
    if ($body === '<h1>My orders</h1>') {
        $body .= '<div class="panel"><p>No orders yet.</p></div>';
    }
    render('My orders', $body);
    exit;
}

if ($action === 'vendor') {
    $vendor = requireRole($user, 'vendor');
    $editProduct = null;
    if (isset($_GET['edit'])) {
        $stmt = $pdo->prepare('SELECT * FROM products WHERE id = ? AND vendor_id = ?');
        $stmt->execute([(int) $_GET['edit'], (int) $vendor['id']]);
        $editProduct = $stmt->fetch() ?: null;
    }

    $stmt = $pdo->prepare('SELECT * FROM products WHERE vendor_id = ? ORDER BY created_at DESC, id DESC');
    $stmt->execute([(int) $vendor['id']]);
    $productRows = '';
    foreach ($stmt->fetchAll() as $product) {
        $productRows .= '<tr><td>' . h($product['name']) . '<br><span class="muted">' . ((int) $product['active'] ? 'Active' : 'Hidden') . '</span></td><td>' . money((int) $product['price_cents']) . '</td><td>' . (int) $product['stock'] . '</td><td class="actions"><a class="button" href="/?action=vendor&edit=' . (int) $product['id'] . '">Edit</a><form class="inline" method="post" action="/?action=delete_product"><input type="hidden" name="id" value="' . (int) $product['id'] . '"><button class="secondary">Delete</button></form></td></tr>';
    }

    $stmt = $pdo->prepare('SELECT oi.*, o.created_at, o.id AS order_number, buyer.name AS buyer_name FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN users buyer ON buyer.id = o.buyer_id WHERE oi.vendor_id = ? ORDER BY o.created_at DESC, oi.id DESC');
    $stmt->execute([(int) $vendor['id']]);
    $orderRows = '';
    foreach ($stmt->fetchAll() as $item) {
        $orderRows .= '<tr><td>#' . (int) $item['order_number'] . '<br><span class="muted">' . h($item['created_at']) . '</span></td><td>' . h($item['buyer_name']) . '</td><td>' . h($item['product_name']) . '</td><td>' . (int) $item['quantity'] . '</td><td>' . money((int) $item['line_total_cents']) . '</td></tr>';
    }

    $formTitle = $editProduct ? 'Edit product' : 'Add product';
    $checked = !$editProduct || (int) $editProduct['active'] ? ' checked' : '';
    $form = '<div class="panel"><h1>' . $formTitle . '</h1><form method="post" action="/?action=save_product"><input type="hidden" name="id" value="' . (int) ($editProduct['id'] ?? 0) . '"><label>Name</label><input name="name" value="' . h($editProduct['name'] ?? '') . '" required><label>Description</label><textarea name="description" rows="4">' . h($editProduct['description'] ?? '') . '</textarea><label>Price</label><input name="price" type="number" min="0" step="0.01" value="' . h(isset($editProduct['price_cents']) ? number_format((int) $editProduct['price_cents'] / 100, 2, '.', '') : '') . '" required><label>Stock</label><input name="stock" type="number" min="0" value="' . h((string) ($editProduct['stock'] ?? '0')) . '" required><label><input style="width:auto" name="active" type="checkbox"' . $checked . '> Active</label><p><button>Save product</button></p></form></div>';

    $body = '<div class="split">' . $form . '<div class="panel"><h1>Your products</h1><table><tr><th>Product</th><th>Price</th><th>Stock</th><th>Actions</th></tr>' . ($productRows ?: '<tr><td colspan="4">No products yet.</td></tr>') . '</table></div></div><h2>Your order lines</h2><table><tr><th>Order</th><th>Buyer</th><th>Product</th><th>Qty</th><th>Total</th></tr>' . ($orderRows ?: '<tr><td colspan="5">No orders yet.</td></tr>') . '</table>';
    render('Vendor dashboard', $body);
    exit;
}

$stmt = $pdo->query('SELECT p.*, u.name AS vendor_name FROM products p JOIN users u ON u.id = p.vendor_id WHERE p.active = 1 AND p.stock > 0 ORDER BY p.created_at DESC, p.id DESC');
$cards = '';
foreach ($stmt->fetchAll() as $product) {
    $buyForm = $user && $user['role'] === 'buyer'
        ? '<form method="post" action="/?action=add_to_cart"><input type="hidden" name="product_id" value="' . (int) $product['id'] . '"><label>Quantity</label><input name="quantity" type="number" min="1" max="' . (int) $product['stock'] . '" value="1"><p><button>Add to cart</button></p></form>'
        : '<p><a class="button" href="/?action=login">Sign in to buy</a></p>';
    $cards .= '<article class="card"><h2>' . h($product['name']) . '</h2><p class="muted">Sold by ' . h($product['vendor_name']) . '</p><p>' . h($product['description']) . '</p><p class="price">' . money((int) $product['price_cents']) . '</p><p class="muted">' . (int) $product['stock'] . ' in stock</p>' . $buyForm . '</article>';
}

render('Shop', '<h1>Shop all vendors</h1><div class="grid">' . $cards . '</div>');
