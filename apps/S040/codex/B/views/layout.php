<?php require_once dirname(__DIR__) . '/src/helpers.php'; ?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Secure Classifieds</title>
    <link rel="stylesheet" href="/styles.css">
</head>
<body>
<header class="topbar">
    <a class="brand" href="/">Classifieds</a>
    <nav>
        <?php if (App\Security::userId()): ?>
            <a href="/listing/new">Post item</a>
            <form method="post" action="/logout" class="inline"><?= csrf_field() ?><button type="submit">Log out</button></form>
        <?php else: ?>
            <a href="/login">Log in</a>
            <a href="/register">Register</a>
        <?php endif; ?>
    </nav>
</header>
<main class="container">
    <?php require __DIR__ . '/' . $template . '.php'; ?>
</main>
</body>
</html>
