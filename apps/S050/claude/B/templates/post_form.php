<?php
/** @var string $mode    'create' | 'edit' */
/** @var string $caption */
/** @var string $action */
/** @var array  $post    Present in edit mode. */
/** @var array  $errors */
$errors = $errors ?? [];
$isEdit = $mode === 'edit';
?>
<h1><?= $isEdit ? 'Edit post' : 'New post' ?></h1>

<?php foreach ($errors as $err): ?>
    <div class="error"><?= e($err) ?></div>
<?php endforeach; ?>

<?php if ($isEdit && isset($post)): ?>
    <p class="muted">Current image:</p>
    <img class="preview" src="/media/<?= (int) $post['id'] ?>" alt="Current image">
<?php endif; ?>

<form method="post" action="<?= e($action) ?>" enctype="multipart/form-data" class="stack">
    <?= csrf_field() ?>
    <label>Image<?= $isEdit ? ' (leave empty to keep the current one)' : '' ?>
        <input type="file" name="image" accept="image/jpeg,image/png,image/gif,image/webp"
               <?= $isEdit ? '' : 'required' ?>>
        <small class="hint">JPEG, PNG, GIF, or WebP. Max 5 MiB.</small>
    </label>
    <label>Caption
        <textarea name="caption" rows="3" maxlength="2000"
                  placeholder="Say something about this photo…"><?= e($caption) ?></textarea>
    </label>
    <div class="formactions">
        <button type="submit"><?= $isEdit ? 'Save changes' : 'Publish' ?></button>
        <a href="/" class="cancel">Cancel</a>
    </div>
</form>
