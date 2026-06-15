<?php
/** @var array $images */
namespace App;
?>
<h1>Gallery</h1>

<?php if (!$images): ?>
    <p class="muted">No images yet.
        <?php if ($user): ?>
            <a href="/upload">Upload the first one.</a>
        <?php else: ?>
            <a href="/login">Sign in</a> to add one.
        <?php endif; ?>
    </p>
<?php else: ?>
    <ul class="grid">
        <?php foreach ($images as $img): ?>
            <li class="card">
                <a href="/view/<?= (int) $img['id'] ?>">
                    <img class="thumb"
                         src="/thumb/<?= (int) $img['id'] ?>"
                         alt="<?= e($img['caption'] !== '' ? $img['caption'] : 'Uploaded image') ?>"
                         loading="lazy">
                </a>
                <?php if ($img['caption'] !== ''): ?>
                    <p class="caption"><?= e($img['caption']) ?></p>
                <?php endif; ?>
                <p class="meta">by <?= e($img['username']) ?></p>
            </li>
        <?php endforeach; ?>
    </ul>
<?php endif; ?>
