<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/bootstrap.php';

$id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);
$image = $id ? find_image($id) : null;

if (!$image) {
    http_response_code(404);
}
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><?= $image ? h($image['caption']) : 'Image Not Found' ?> - Image Gallery</title>
  <link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
  <header class="topbar">
    <a class="brand" href="/">Image Gallery</a>
    <nav>
      <?php if (current_user()): ?>
        <a href="/upload.php">Upload</a>
        <a href="/logout.php">Log out</a>
      <?php else: ?>
        <a href="/login.php">Log in</a>
      <?php endif; ?>
    </nav>
  </header>

  <main class="detail-page">
    <?php if (!$image): ?>
      <section class="empty">
        <h1>Image not found</h1>
        <p>The image may have been removed.</p>
      </section>
    <?php else: ?>
      <figure class="image-detail">
        <img src="<?= h(public_image_path($image['file_path'])) ?>" alt="<?= h($image['caption']) ?>">
        <figcaption>
          <h1><?= h($image['caption']) ?></h1>
          <p>Uploaded by <?= h($image['username']) ?> on <?= h(format_date($image['created_at'])) ?></p>
        </figcaption>
      </figure>
    <?php endif; ?>
  </main>
</body>
</html>
