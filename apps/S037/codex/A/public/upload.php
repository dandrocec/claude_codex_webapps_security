<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/bootstrap.php';

require_login();

$errors = [];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    verify_csrf();

    $caption = trim((string) ($_POST['caption'] ?? ''));

    if ($caption === '' || strlen($caption) > 180) {
        $errors[] = 'Caption is required and must be 180 characters or fewer.';
    }

    if (!isset($_FILES['image'])) {
        $errors[] = 'Choose an image to upload.';
    }

    if (!$errors) {
        try {
            save_uploaded_image($_FILES['image'], $caption, (int) current_user()['id']);
            set_flash('success', 'Image uploaded.');
            redirect('/');
        } catch (RuntimeException $e) {
            $errors[] = $e->getMessage();
        }
    }
}
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Upload - Image Gallery</title>
  <link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
  <header class="topbar">
    <a class="brand" href="/">Image Gallery</a>
    <nav><a href="/logout.php">Log out</a></nav>
  </header>

  <main class="auth-page">
    <form class="panel" method="post" enctype="multipart/form-data">
      <h1>Upload Image</h1>
      <?php foreach ($errors as $error): ?>
        <div class="flash error"><?= h($error) ?></div>
      <?php endforeach; ?>
      <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
      <label>
        Caption
        <input name="caption" maxlength="180" required value="<?= h((string) ($_POST['caption'] ?? '')) ?>">
      </label>
      <label>
        Image
        <input name="image" type="file" accept="image/jpeg,image/png,image/gif,image/webp" required>
      </label>
      <button type="submit">Upload</button>
    </form>
  </main>
</body>
</html>
