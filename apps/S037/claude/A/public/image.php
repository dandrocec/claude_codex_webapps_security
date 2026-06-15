<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';
require __DIR__ . '/../src/layout.php';

$id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);
if (!$id) {
    http_response_code(404);
    render_header('Not found');
    echo '<p class="empty">Image not found. <a href="index.php">Back to the gallery</a>.</p>';
    render_footer();
    exit;
}

$stmt = db()->prepare('
    SELECT images.caption, images.filename, images.created_at, users.username
    FROM images
    JOIN users ON users.id = images.user_id
    WHERE images.id = ?
');
$stmt->execute([$id]);
$img = $stmt->fetch();

if (!$img) {
    http_response_code(404);
    render_header('Not found');
    echo '<p class="empty">Image not found. <a href="index.php">Back to the gallery</a>.</p>';
    render_footer();
    exit;
}

render_header($img['caption'] !== '' ? $img['caption'] : 'Image');
?>
<p><a href="index.php">&larr; Back to the gallery</a></p>

<figure class="full-image">
    <img src="<?= e(UPLOAD_URL . '/' . $img['filename']) ?>"
         alt="<?= e($img['caption']) ?>">
    <figcaption>
        <h1><?= e($img['caption'] !== '' ? $img['caption'] : 'Untitled') ?></h1>
        <p class="meta">Uploaded by <?= e($img['username']) ?> on <?= e($img['created_at']) ?></p>
    </figcaption>
</figure>

<?php
render_footer();
