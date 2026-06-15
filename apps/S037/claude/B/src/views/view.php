<?php
/** @var array $image */
/** @var bool $is_owner */
namespace App;
?>
<p><a href="/">&larr; Back to gallery</a></p>

<figure class="single">
    <img src="/image/<?= (int) $image['id'] ?>"
         alt="<?= e($image['caption'] !== '' ? $image['caption'] : 'Uploaded image') ?>">
    <?php if ($image['caption'] !== ''): ?>
        <figcaption><?= e($image['caption']) ?></figcaption>
    <?php endif; ?>
</figure>

<p class="meta">
    Uploaded by <?= e($image['username']) ?> on <?= e($image['created_at']) ?> (UTC)
</p>

<?php if ($is_owner): ?>
    <form method="post" action="/delete" class="delete-form">
        <?= csrf_field() ?>
        <input type="hidden" name="id" value="<?= (int) $image['id'] ?>">
        <button type="submit" class="danger">Delete image</button>
    </form>
<?php endif; ?>
