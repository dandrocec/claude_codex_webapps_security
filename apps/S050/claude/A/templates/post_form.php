<?php
/** @var array<string,mixed>|null $post  Existing post when editing, null when creating. */
/** @var string|null $error */
$editing = $post !== null && !empty($post['id']);
$action  = $editing ? '/posts/' . (int) $post['id'] . '/update' : '/posts';
$caption = $post['caption'] ?? '';
?>
<h1><?= $editing ? 'Edit post' : 'New post' ?></h1>
<?php if ($error !== null): ?>
    <div class="error"><?= e($error) ?></div>
<?php endif; ?>

<?php if ($editing && !empty($post['image_path'])): ?>
    <p class="muted">Current image:</p>
    <div class="card"><img src="<?= e($post['image_path']) ?>" alt="Current image"></div>
<?php endif; ?>

<form method="post" action="<?= e($action) ?>" enctype="multipart/form-data">
    <input type="hidden" name="csrf_token" value="<?= e(csrf_token()) ?>">

    <label for="image">Image<?= $editing ? ' (leave empty to keep current)' : '' ?></label>
    <input type="file" id="image" name="image" accept="image/*" <?= $editing ? '' : 'required' ?>>

    <label for="caption">Caption</label>
    <textarea id="caption" name="caption" maxlength="2000" placeholder="Say something about this photo…"><?= e($caption) ?></textarea>

    <p>
        <button class="btn" type="submit"><?= $editing ? 'Save changes' : 'Publish' ?></button>
        <a class="btn secondary" href="/">Cancel</a>
    </p>
</form>
