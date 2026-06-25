<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= e($title) ?> - <?= APP_NAME ?></title>
    <link rel="stylesheet" href="/styles.css">
</head>
<body>
    <header class="site-header">
        <a class="brand" href="/"><?= APP_NAME ?></a>
        <nav>
            <a href="/">Quotes</a>
            <?php if ($currentUser): ?>
                <a href="/dashboard">Dashboard</a>
                <a class="button small" href="/quotes/new">Submit</a>
                <a href="/logout">Logout</a>
            <?php else: ?>
                <a href="/login">Login</a>
                <a class="button small" href="/register">Register</a>
            <?php endif; ?>
        </nav>
    </header>

    <main class="container">
        <?php if ($flash): ?>
            <div class="flash <?= e($flash['type']) ?>"><?= e($flash['message']) ?></div>
        <?php endif; ?>

        <?php require __DIR__ . '/' . $view . '.php'; ?>
    </main>
</body>
</html>
