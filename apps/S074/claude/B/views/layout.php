<?php
/** @var string $content */
/** @var string $title */
/** @var array<int,array{type:string,message:string}> $flashes */
/** @var array{id:int,email:string,name:string,role:string}|null $currentUser */
/** @var int $cartCount */
use App\Csrf;
use function App\e;
?><!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= e($title ?? 'Marketplace') ?> · Marketplace</title>
    <link rel="stylesheet" href="/css/app.css">
</head>
<body>
<header class="topbar">
    <div class="wrap">
        <a class="brand" href="/">🛍️ Marketplace</a>
        <nav>
            <a href="/">Shop</a>
            <?php if ($currentUser === null): ?>
                <a href="/cart">Cart (<?= (int) $cartCount ?>)</a>
                <a href="/login">Sign in</a>
                <a href="/register">Register</a>
            <?php elseif ($currentUser['role'] === 'vendor'): ?>
                <a href="/vendor/products">My products</a>
                <a href="/vendor/orders">My orders</a>
                <span class="who">Vendor: <?= e($currentUser['name']) ?></span>
                <form method="post" action="/logout" class="inline">
                    <?= Csrf::field() ?>
                    <button type="submit" class="linkbtn">Sign out</button>
                </form>
            <?php else: ?>
                <a href="/cart">Cart (<?= (int) $cartCount ?>)</a>
                <a href="/orders">My orders</a>
                <span class="who">Buyer: <?= e($currentUser['name']) ?></span>
                <form method="post" action="/logout" class="inline">
                    <?= Csrf::field() ?>
                    <button type="submit" class="linkbtn">Sign out</button>
                </form>
            <?php endif; ?>
        </nav>
    </div>
</header>

<main class="wrap">
    <?php foreach ($flashes as $flash): ?>
        <div class="flash flash-<?= e($flash['type']) ?>"><?= e($flash['message']) ?></div>
    <?php endforeach; ?>

    <?= $content /* already-rendered, encoded view output */ ?>
</main>

<footer class="wrap foot">
    <p>Demo multi-vendor marketplace · built with plain PHP &amp; SQLite.</p>
</footer>
</body>
</html>
