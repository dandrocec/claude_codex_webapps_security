<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';
require __DIR__ . '/../src/layout.php';

$images = db()->query('
    SELECT images.id, images.caption, images.thumb_filename, images.created_at,
           users.username
    FROM images
    JOIN users ON users.id = images.user_id
    ORDER BY images.created_at DESC, images.id DESC
')->fetchAll();

render_header('Gallery');
?>
<h1>Public Gallery</h1>

<?php if (!$images): ?>
    <p class="empty">No images yet. <a href="login.php">Log in</a> to upload the first one.</p>
<?php else: ?>
    <ul class="gallery">
        <?php foreach ($images as $img): ?>
            <li class="card">
                <a href="image.php?id=<?= (int) $img['id'] ?>" title="<?= e($img['caption']) ?>">
                    <img src="<?= e(THUMB_URL . '/' . $img['thumb_filename']) ?>"
                         alt="<?= e($img['caption'] !== '' ? $img['caption'] : 'Untitled image') ?>"
                         loading="lazy">
                </a>
                <div class="card-body">
                    <p class="caption"><?= e($img['caption'] !== '' ? $img['caption'] : 'Untitled') ?></p>
                    <p class="meta">by <?= e($img['username']) ?></p>
                </div>
            </li>
        <?php endforeach; ?>
    </ul>
<?php endif; ?>

<?php
render_footer();
