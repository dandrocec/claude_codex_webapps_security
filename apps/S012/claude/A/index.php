<?php
// Contact form page.
$error = isset($_GET['error']) ? $_GET['error'] : '';
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Contact Us</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <main class="card">
        <h1>Contact Us</h1>
        <p class="subtitle">Send us a message and we'll get back to you.</p>

        <?php if ($error !== ''): ?>
            <p class="alert"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></p>
        <?php endif; ?>

        <form action="submit.php" method="post" novalidate>
            <label for="name">Name</label>
            <input type="text" id="name" name="name" required
                   value="<?= htmlspecialchars($_GET['name'] ?? '', ENT_QUOTES, 'UTF-8') ?>">

            <label for="email">Email</label>
            <input type="email" id="email" name="email" required
                   value="<?= htmlspecialchars($_GET['email'] ?? '', ENT_QUOTES, 'UTF-8') ?>">

            <label for="message">Message</label>
            <textarea id="message" name="message" rows="5" required><?= htmlspecialchars($_GET['message'] ?? '', ENT_QUOTES, 'UTF-8') ?></textarea>

            <button type="submit">Send message</button>
        </form>

        <p class="links"><a href="list.php">View all submissions &rarr;</a></p>
    </main>
</body>
</html>
