<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/bootstrap.php';

$images = latest_images();
$flash = flash();
$user = current_user();
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Image Gallery</title>
  <link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
  <header class="topbar">
    <a class="brand" href="/">Image Gallery</a>
    <nav>
      <?php if ($user): ?>
        <a href="/upload.php">Upload</a>
        <span><?= h($user['username']) ?></span>
        <a href="/logout.php">Log out</a>
      <?php else: ?>
        <a href="/login.php">Log in</a>
        <a class="button-link" href="/register.php">Register</a>
      <?php endif; ?>
    </nav>
  </header>

  <main class="page">
    <?php if ($flash): ?>
      <div class="flash <?= h($flash['type']) ?>"><?= h($flash['message']) ?></div>
    <?php endif; ?>

    <section class="intro">
      <h1>Public Gallery</h1>
      <p>Browse recent uploads. Select a thumbnail to view the full image and caption.</p>
    </section>

    <?php if (!$images): ?>
      <section class="empty">
        <h2>No images yet</h2>
        <p><?php if ($user): ?>Upload the first image.<?php else: ?>Create an account or log in to upload the first image.<?php endif; ?></p>
      </section>
    <?php else: ?>
      <section class="grid" aria-label="Uploaded images">
        <?php foreach ($images as $image): ?>
          <article class="tile">
            <a href="/image.php?id=<?= (int) $image['id'] ?>">
              <img src="<?= h(public_image_path($image['thumb_path'] ?: $image['file_path'])) ?>" alt="<?= h($image['caption']) ?>">
            </a>
            <div class="tile-caption">
              <h2><?= h($image['caption']) ?></h2>
              <p>By <?= h($image['username']) ?> on <?= h(format_date($image['created_at'])) ?></p>
            </div>
          </article>
        <?php endforeach; ?>
      </section>
    <?php endif; ?>
  </main>
</body>
</html>
