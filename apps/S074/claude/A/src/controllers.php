<?php

declare(strict_types=1);

/* ============================================================================
 * Public storefront — buyers shop across ALL vendors
 * ========================================================================== */

function home_page(): void
{
    $search = trim((string) ($_GET['q'] ?? ''));
    $sql =
        'SELECT p.*, u.shop_name, u.name AS vendor_name
         FROM products p JOIN users u ON u.id = p.vendor_id';
    $params = [];
    if ($search !== '') {
        $sql .= ' WHERE p.name LIKE ? OR p.description LIKE ?';
        $params[] = '%' . $search . '%';
        $params[] = '%' . $search . '%';
    }
    $sql .= ' ORDER BY p.created_at DESC, p.id DESC';

    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    render('home', ['products' => $stmt->fetchAll(), 'search' => $search]);
}

function product_page(): void
{
    $id = (int) ($_GET['id'] ?? 0);
    $stmt = db()->prepare(
        'SELECT p.*, u.shop_name, u.name AS vendor_name
         FROM products p JOIN users u ON u.id = p.vendor_id
         WHERE p.id = ?'
    );
    $stmt->execute([$id]);
    $product = $stmt->fetch();
    if (!$product) {
        http_response_code(404);
        render('error', ['title' => 'Not found', 'message' => 'That product does not exist.']);
        return;
    }
    render('product', ['product' => $product]);
}

/* ============================================================================
 * Cart — a single shared cart spanning every vendor
 * ========================================================================== */

function cart_add(): void
{
    csrf_check();
    $id  = (int) post('product_id');
    $qty = max(1, (int) post('quantity', '1'));

    $stmt = db()->prepare('SELECT id, name, stock FROM products WHERE id = ?');
    $stmt->execute([$id]);
    $product = $stmt->fetch();
    if (!$product) {
        flash('That product is no longer available.', 'error');
        redirect('/');
    }

    $current = (int) (cart()[$id] ?? 0);
    $desired = $current + $qty;
    if ($product['stock'] > 0) {
        $desired = min($desired, (int) $product['stock']);
    }
    $_SESSION['cart'][$id] = $desired;

    flash('Added "' . $product['name'] . '" to your cart.');
    redirect('/cart');
}

function cart_view(): void
{
    [$items, $total] = cart_detailed();
    render('cart', ['items' => $items, 'total' => $total]);
}

function cart_update(): void
{
    csrf_check();
    $id  = (int) post('product_id');
    $qty = (int) post('quantity', '0');
    if ($qty <= 0) {
        unset($_SESSION['cart'][$id]);
        flash('Item removed from cart.');
    } else {
        $_SESSION['cart'][$id] = $qty;
        flash('Cart updated.');
    }
    redirect('/cart');
}

function cart_remove(): void
{
    csrf_check();
    $id = (int) post('product_id');
    unset($_SESSION['cart'][$id]);
    flash('Item removed from cart.');
    redirect('/cart');
}

/* ============================================================================
 * Checkout — splits one cart into order_items tagged per vendor
 * ========================================================================== */

function checkout(): void
{
    csrf_check();
    $user = require_role('buyer');

    [$items, $total] = cart_detailed();
    if (!$items) {
        flash('Your cart is empty.', 'error');
        redirect('/cart');
    }

    $pdo = db();
    $pdo->beginTransaction();
    try {
        // Re-check stock inside the transaction to avoid overselling.
        foreach ($items as $item) {
            $p = $item['product'];
            if ($p['stock'] > 0 && $item['quantity'] > $p['stock']) {
                $pdo->rollBack();
                flash('Not enough stock for "' . $p['name'] . '".', 'error');
                redirect('/cart');
            }
        }

        $stmt = $pdo->prepare(
            'INSERT INTO orders (buyer_id, total_cents) VALUES (?, ?)'
        );
        $stmt->execute([$user['id'], $total]);
        $orderId = (int) $pdo->lastInsertId();

        $insItem = $pdo->prepare(
            'INSERT INTO order_items
                (order_id, product_id, vendor_id, product_name, unit_price_cents, quantity)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        $reduceStock = $pdo->prepare(
            'UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?'
        );

        foreach ($items as $item) {
            $p = $item['product'];
            $insItem->execute([
                $orderId, $p['id'], $p['vendor_id'],
                $p['name'], $p['price_cents'], $item['quantity'],
            ]);
            if ($p['stock'] > 0) {
                $reduceStock->execute([$item['quantity'], $p['id'], $item['quantity']]);
            }
        }

        $pdo->commit();
    } catch (Throwable $ex) {
        $pdo->rollBack();
        flash('Checkout failed: ' . $ex->getMessage(), 'error');
        redirect('/cart');
    }

    unset($_SESSION['cart']);
    render('checkout_success', ['order_id' => $orderId, 'total' => $total]);
}

/* ============================================================================
 * Buyer account — their own orders only
 * ========================================================================== */

function buyer_orders(): void
{
    $user = require_role('buyer');
    $pdo = db();

    $stmt = $pdo->prepare(
        'SELECT * FROM orders WHERE buyer_id = ? ORDER BY created_at DESC, id DESC'
    );
    $stmt->execute([$user['id']]);
    $orders = $stmt->fetchAll();

    $itemStmt = $pdo->prepare(
        'SELECT oi.*, u.shop_name
         FROM order_items oi JOIN users u ON u.id = oi.vendor_id
         WHERE oi.order_id = ?'
    );
    foreach ($orders as &$order) {
        $itemStmt->execute([$order['id']]);
        $order['items'] = $itemStmt->fetchAll();
    }
    unset($order);

    render('buyer_orders', ['orders' => $orders]);
}

/* ============================================================================
 * Vendor dashboard — STRICTLY scoped to the logged-in vendor
 * ========================================================================== */

function vendor_products(): void
{
    $user = require_role('vendor');
    $stmt = db()->prepare(
        'SELECT * FROM products WHERE vendor_id = ? ORDER BY created_at DESC, id DESC'
    );
    $stmt->execute([$user['id']]);
    render('vendor_products', ['products' => $stmt->fetchAll()]);
}

function vendor_product_new(): void
{
    require_role('vendor');
    render('vendor_product_form', ['product' => null, 'action' => '/vendor/products/create']);
}

function vendor_product_create(): void
{
    csrf_check();
    $user = require_role('vendor');
    [$ok, $errors, $fields] = validate_product_input();
    if (!$ok) {
        render('vendor_product_form', [
            'product' => $fields, 'action' => '/vendor/products/create', 'errors' => $errors,
        ]);
        return;
    }
    $stmt = db()->prepare(
        'INSERT INTO products (vendor_id, name, description, price_cents, stock)
         VALUES (?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $user['id'], $fields['name'], $fields['description'],
        $fields['price_cents'], $fields['stock'],
    ]);
    flash('Product created.');
    redirect('/vendor/products');
}

function vendor_product_edit(): void
{
    $user = require_role('vendor');
    $product = vendor_owned_product((int) ($_GET['id'] ?? 0), $user);
    render('vendor_product_form', [
        'product' => $product, 'action' => '/vendor/products/update?id=' . $product['id'],
    ]);
}

function vendor_product_update(): void
{
    csrf_check();
    $user = require_role('vendor');
    $product = vendor_owned_product((int) ($_GET['id'] ?? 0), $user);

    [$ok, $errors, $fields] = validate_product_input();
    if (!$ok) {
        $fields['id'] = $product['id'];
        render('vendor_product_form', [
            'product' => $fields,
            'action'  => '/vendor/products/update?id=' . $product['id'],
            'errors'  => $errors,
        ]);
        return;
    }
    $stmt = db()->prepare(
        'UPDATE products SET name = ?, description = ?, price_cents = ?, stock = ?
         WHERE id = ? AND vendor_id = ?'
    );
    $stmt->execute([
        $fields['name'], $fields['description'], $fields['price_cents'],
        $fields['stock'], $product['id'], $user['id'],
    ]);
    flash('Product updated.');
    redirect('/vendor/products');
}

function vendor_product_delete(): void
{
    csrf_check();
    $user = require_role('vendor');
    // The vendor_id clause guarantees a vendor can only delete their own row.
    $stmt = db()->prepare('DELETE FROM products WHERE id = ? AND vendor_id = ?');
    $stmt->execute([(int) post('product_id'), $user['id']]);
    flash('Product deleted.');
    redirect('/vendor/products');
}

function vendor_orders(): void
{
    $user = require_role('vendor');
    // A vendor only sees order lines tagged with their own vendor_id, plus the
    // matching order header — never another vendor's items or totals.
    $stmt = db()->prepare(
        "SELECT oi.*, o.created_at AS order_date, o.status, u.name AS buyer_name
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         JOIN users  u ON u.id = o.buyer_id
         WHERE oi.vendor_id = ?
         ORDER BY o.created_at DESC, oi.order_id DESC"
    );
    $stmt->execute([$user['id']]);

    // Group the vendor's line items by order for display.
    $orders = [];
    $revenue = 0;
    foreach ($stmt->fetchAll() as $row) {
        $oid = $row['order_id'];
        $orders[$oid] ??= [
            'order_id'   => $oid,
            'order_date' => $row['order_date'],
            'status'     => $row['status'],
            'buyer_name' => $row['buyer_name'],
            'items'      => [],
            'subtotal'   => 0,
        ];
        $line = $row['unit_price_cents'] * $row['quantity'];
        $orders[$oid]['items'][] = $row;
        $orders[$oid]['subtotal'] += $line;
        $revenue += $line;
    }

    render('vendor_orders', ['orders' => array_values($orders), 'revenue' => $revenue]);
}

/* ---- Vendor helpers ------------------------------------------------------ */

/**
 * Fetches a product owned by $user or aborts with 404 if it belongs to
 * another vendor / does not exist. Central guard for ownership checks.
 */
function vendor_owned_product(int $id, array $user): array
{
    $stmt = db()->prepare('SELECT * FROM products WHERE id = ? AND vendor_id = ?');
    $stmt->execute([$id, $user['id']]);
    $product = $stmt->fetch();
    if (!$product) {
        http_response_code(404);
        render('error', ['title' => 'Not found',
            'message' => 'That product does not exist in your shop.']);
        exit;
    }
    return $product;
}

/**
 * Validates and normalizes product form input.
 * Returns [bool ok, array errors, array fields].
 */
function validate_product_input(): array
{
    $errors = [];
    $name        = post('name');
    $description = post('description');
    $priceRaw    = post('price');
    $stockRaw    = post('stock', '0');

    if ($name === '') {
        $errors['name'] = 'Name is required.';
    }
    if (!is_numeric($priceRaw) || (float) $priceRaw < 0) {
        $errors['price'] = 'Enter a valid price (e.g. 19.99).';
    }
    if (!ctype_digit($stockRaw) && $stockRaw !== '') {
        $errors['stock'] = 'Stock must be a whole number.';
    }

    $fields = [
        'name'        => $name,
        'description' => $description,
        'price_cents' => (int) round(((float) $priceRaw) * 100),
        'stock'       => (int) $stockRaw,
        // Echo the raw price back into the form on error.
        'price'       => $priceRaw,
    ];
    return [empty($errors), $errors, $fields];
}

/* ============================================================================
 * Authentication
 * ========================================================================== */

function show_login(): void
{
    render('login', []);
}

function do_login(): void
{
    csrf_check();
    $email    = strtolower(post('email'));
    $password = post('password');

    $stmt = db()->prepare('SELECT * FROM users WHERE email = ?');
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        flash('Invalid email or password.', 'error');
        render('login', ['email' => $email]);
        return;
    }

    session_regenerate_id(true);
    $_SESSION['user_id'] = $user['id'];
    flash('Welcome back, ' . $user['name'] . '!');
    redirect($user['role'] === 'vendor' ? '/vendor/products' : '/');
}

function show_register(): void
{
    render('register', []);
}

function do_register(): void
{
    csrf_check();
    $name     = post('name');
    $email    = strtolower(post('email'));
    $password = post('password');
    $role     = post('role');
    $shopName = post('shop_name');

    $errors = [];
    if ($name === '')                                    $errors[] = 'Name is required.';
    if (!filter_var($email, FILTER_VALIDATE_EMAIL))      $errors[] = 'A valid email is required.';
    if (strlen($password) < 6)                           $errors[] = 'Password must be at least 6 characters.';
    if (!in_array($role, ['vendor', 'buyer'], true))     $errors[] = 'Please choose an account type.';
    if ($role === 'vendor' && $shopName === '')          $errors[] = 'Vendors must provide a shop name.';

    if ($errors) {
        render('register', ['errors' => $errors, 'name' => $name, 'email' => $email,
            'role' => $role, 'shop_name' => $shopName]);
        return;
    }

    try {
        $stmt = db()->prepare(
            'INSERT INTO users (name, email, password_hash, role, shop_name)
             VALUES (?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $name, $email, password_hash($password, PASSWORD_DEFAULT),
            $role, $role === 'vendor' ? $shopName : null,
        ]);
    } catch (PDOException $ex) {
        render('register', ['errors' => ['That email is already registered.'],
            'name' => $name, 'email' => $email, 'role' => $role, 'shop_name' => $shopName]);
        return;
    }

    session_regenerate_id(true);
    $_SESSION['user_id'] = (int) db()->lastInsertId();
    flash('Your account has been created.');
    redirect($role === 'vendor' ? '/vendor/products' : '/');
}

function do_logout(): void
{
    csrf_check();
    $_SESSION = [];
    session_destroy();
    redirect('/');
}
