<?php require_once __DIR__ . '/helpers.php'; ?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= e($title ?? 'Vendor Market') ?></title>
    <link rel="stylesheet" href="/styles.css">
</head>
<body>
<header class="topbar">
    <a class="brand" href="/">Vendor Market</a>
    <nav>
        <a href="/">Shop</a>
        <a href="/cart">Cart (<?= e($cart->count()) ?>)</a>
        <?php if ($auth->user()): ?>
            <?php if ($auth->user()['role'] === 'vendor'): ?>
                <a href="/vendor">Vendor Dashboard</a>
            <?php else: ?>
                <a href="/orders">Orders</a>
            <?php endif; ?>
            <form class="inline" method="post" action="/logout">
                <input type="hidden" name="csrf_token" value="<?= e($csrf->token()) ?>">
                <button type="submit">Sign out</button>
            </form>
        <?php else: ?>
            <a href="/login">Sign in</a>
            <a href="/register">Register</a>
        <?php endif; ?>
    </nav>
</header>
<main class="container">
    <?php if (isset($error)): ?><div class="alert"><?= e($error) ?></div><?php endif; ?>
    <?php $this->includeTemplate($templateFile); ?>
</main>
</body>
</html>
