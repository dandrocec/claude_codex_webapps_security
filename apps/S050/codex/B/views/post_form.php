<?php
use PhotoBlog\Security;

$editing = !empty($post);
?>
<section class="editor">
  <h1><?= $editing ? 'Edit post' : 'New post' ?></h1>
  <form method="post" action="<?= Security::e($action) ?>" enctype="multipart/form-data">
    <input type="hidden" name="csrf_token" value="<?= Security::e(Security::csrfToken()) ?>">
    <?php if ($editing): ?>
      <img class="preview" src="/image?file=<?= rawurlencode($post['image_name']) ?>" alt="">
    <?php endif; ?>
    <label>Image
      <input name="image" type="file" accept="image/jpeg,image/png,image/gif,image/webp" <?= $editing ? '' : 'required' ?>>
    </label>
    <label>Caption
      <textarea name="caption" required maxlength="500" rows="5"><?= Security::e($post['caption'] ?? '') ?></textarea>
    </label>
    <button type="submit"><?= $editing ? 'Save changes' : 'Publish' ?></button>
  </form>
</section>
