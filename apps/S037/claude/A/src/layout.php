<?php
declare(strict_types=1);

/** Render the page header. Call render_footer() at the end of the page. */
function render_header(string $title): void
{
    $user = current_user();
    ?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= e($title) ?> &middot; PHP Image Gallery</title>
    <link rel="stylesheet" href="assets/style.css">
</head>
<body>
<header class="site-header">
    <a class="brand" href="index.php">📷 Image Gallery</a>
    <nav>
        <?php if ($user): ?>
            <a href="upload.php">Upload</a>
            <span class="user">Hi, <?= e($user['username']) ?></span>
            <form class="inline" method="post" action="logout.php">
                <input type="hidden" name="csrf" value="<?= e(csrf_token()) ?>">
                <button type="submit" class="linkbtn">Log out</button>
            </form>
        <?php else: ?>
            <a href="login.php">Log in</a>
        <?php endif; ?>
    </nav>
</header>
<main class="container">
<?php
}

function render_footer(): void
{
    ?>
</main>
<footer class="site-footer">
    <p>PHP Image Gallery &mdash; running on port 5037.</p>
</footer>
</body>
</html>
<?php
}
