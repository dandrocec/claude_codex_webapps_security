<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';
require __DIR__ . '/../src/images.php';
require __DIR__ . '/../src/layout.php';

$user = require_login();
$error = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    check_csrf();
    try {
        $caption = trim((string) ($_POST['caption'] ?? ''));
        if (mb_strlen($caption) > 280) {
            throw new RuntimeException('Caption is too long (max 280 characters).');
        }

        $file = $_FILES['image'] ?? [];
        $mime = validate_upload($file);
        $ext = ALLOWED_IMAGE_TYPES[$mime];

        // Unique, non-guessable filenames; thumbnails are always JPEG.
        $base = bin2hex(random_bytes(16));
        $filename = $base . '.' . $ext;
        $thumbName = $base . '.jpg';

        $destPath = UPLOAD_DIR . '/' . $filename;
        if (!move_uploaded_file($file['tmp_name'], $destPath)) {
            throw new RuntimeException('Could not save the uploaded file.');
        }

        try {
            make_thumbnail($destPath, $mime, THUMB_DIR . '/' . $thumbName);
        } catch (Throwable $e) {
            @unlink($destPath);
            throw $e;
        }

        $stmt = db()->prepare('
            INSERT INTO images (user_id, caption, filename, thumb_filename, original_name)
            VALUES (?, ?, ?, ?, ?)
        ');
        $stmt->execute([
            $user['id'],
            $caption,
            $filename,
            $thumbName,
            (string) ($file['name'] ?? 'upload'),
        ]);

        header('Location: image.php?id=' . (int) db()->lastInsertId());
        exit;
    } catch (Throwable $e) {
        $error = $e->getMessage();
    }
}

render_header('Upload');
?>
<h1>Upload an image</h1>

<?php if ($error): ?>
    <p class="flash error"><?= e($error) ?></p>
<?php endif; ?>

<form class="form" method="post" action="upload.php" enctype="multipart/form-data">
    <input type="hidden" name="csrf" value="<?= e(csrf_token()) ?>">
    <label>Image file
        <input type="file" name="image" accept="image/jpeg,image/png,image/gif,image/webp" required>
    </label>
    <label>Caption
        <input type="text" name="caption" maxlength="280" placeholder="Say something about this image">
    </label>
    <button type="submit">Upload</button>
</form>

<p class="hint">Accepted: JPEG, PNG, GIF, WebP &middot; up to 8 MB.</p>

<?php
render_footer();
