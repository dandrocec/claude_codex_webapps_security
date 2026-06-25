<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Market Board</title>
    <link rel="stylesheet" href="/styles.css">
</head>
<body>
    <header class="site-header">
        <a class="brand" href="/">Market Board</a>
        <nav class="nav">
            <a href="/">Browse</a>
            <?php if ($currentUser): ?>
                <a href="/dashboard">My listings</a>
                <a class="button" href="/listings/new">Post item</a>
                <form method="post" action="/logout">
                    <button type="submit">Log out</button>
                </form>
            <?php else: ?>
                <a href="/login">Log in</a>
                <a class="button" href="/register">Register</a>
            <?php endif; ?>
        </nav>
    </header>

    <main class="container">
        <?php if ($flash): ?>
            <div class="notice"><?= e($flash) ?></div>
        <?php endif; ?>

        <?php require BASE_PATH . '/views/' . $view . '.php'; ?>
    </main>
</body>
</html>
