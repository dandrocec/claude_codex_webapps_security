<?php
/** @var string $title */
/** @var string $content */

use App\Auth;
use App\Helpers;

$flash = Helpers::flash();
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= Helpers::e($title) ?> &middot; RealEstate</title>
    <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
<header class="site-header">
    <div class="container header-inner">
        <a class="brand" href="/">🏠 RealEstate</a>
        <nav>
            <a href="/">Browse</a>
            <?php if (Auth::check()): ?>
                <a href="/dashboard">My listings</a>
                <a href="/listings/new">+ New listing</a>
                <form action="/logout" method="post" class="inline">
                    <button type="submit" class="link-button">Log out (<?= Helpers::e(Auth::name()) ?>)</button>
                </form>
            <?php else: ?>
                <a href="/login">Agent login</a>
                <a href="/register" class="btn btn-small">Become an agent</a>
            <?php endif; ?>
        </nav>
    </div>
</header>

<main class="container">
    <?php if ($flash): ?>
        <div class="flash"><?= Helpers::e($flash) ?></div>
    <?php endif; ?>
    <?= $content ?>
</main>

<footer class="site-footer">
    <div class="container">
        <p>RealEstate demo &middot; agents post listings, visitors search &amp; contact.</p>
    </div>
</footer>
</body>
</html>
