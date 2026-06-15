<?php
/** @var list<array<string,mixed>> $posts */
$user = current_user();
?>
<?php if (count($posts) === 0): ?>
    <p class="empty">No posts yet.
        <?php if ($user !== null): ?>
            <a href="/posts/new">Publish the first one →</a>
        <?php else: ?>
            <a href="/login">Log in</a> to publish one.
        <?php endif; ?>
    </p>
<?php else: ?>
    <?php foreach ($posts as $post): ?>
        <article class="card">
            <img src="<?= e($post['image_path']) ?>" alt="<?= e($post['caption']) ?: 'Photo' ?>" loading="lazy">
            <div class="body">
                <div class="meta">
                    <strong><?= e($post['username']) ?></strong>
                    · <?= e($post['created_at']) ?> UTC
                </div>
                <?php if (trim((string) $post['caption']) !== ''): ?>
                    <p class="caption"><?= e($post['caption']) ?></p>
                <?php endif; ?>
                <?php if ($user !== null && (int) $user['id'] === (int) $post['user_id']): ?>
                    <div class="actions">
                        <a href="/posts/<?= (int) $post['id'] ?>/edit">Edit</a>
                        <form class="inline" method="post"
                              action="/posts/<?= (int) $post['id'] ?>/delete"
                              onsubmit="return confirm('Delete this post?');">
                            <input type="hidden" name="csrf_token" value="<?= e(csrf_token()) ?>">
                            <button class="btn danger" type="submit">Delete</button>
                        </form>
                    </div>
                <?php endif; ?>
            </div>
        </article>
    <?php endforeach; ?>
<?php endif; ?>
