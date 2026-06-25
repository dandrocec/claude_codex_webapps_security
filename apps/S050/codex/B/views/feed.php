<?php
use PhotoBlog\Security;
?>
<section class="feed-header">
  <h1>Latest photos</h1>
</section>

<?php if (!$posts): ?>
  <p class="empty">No posts yet.</p>
<?php endif; ?>

<div class="feed">
  <?php foreach ($posts as $post): ?>
    <article class="post">
      <img src="/image?file=<?= rawurlencode($post['image_name']) ?>" alt="">
      <div class="post-body">
        <p><?= nl2br(Security::e($post['caption'])) ?></p>
        <div class="meta">
          <span>By <?= Security::e($post['username']) ?></span>
          <time datetime="<?= Security::e($post['created_at']) ?>"><?= Security::e($post['created_at']) ?></time>
        </div>
        <?php if (!empty($user) && (int)$user['id'] === (int)$post['user_id']): ?>
          <div class="actions">
            <a href="/posts/<?= (int)$post['id'] ?>/edit">Edit</a>
            <form action="/posts/<?= (int)$post['id'] ?>/delete" method="post" class="inline">
              <input type="hidden" name="csrf_token" value="<?= Security::e(Security::csrfToken()) ?>">
              <button type="submit">Delete</button>
            </form>
          </div>
        <?php endif; ?>
      </div>
    </article>
  <?php endforeach; ?>
</div>
