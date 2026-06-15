<?php
/** @var array $posts */
/** @var array|null $user */
?>
<h1>Latest posts</h1>

<?php if (!$posts): ?>
    <p class="muted">No posts yet.
        <?php if ($user): ?><a href="/posts/new">Be the first to publish one.</a>
        <?php else: ?><a href="/login">Log in</a> to publish the first one.<?php endif; ?>
    </p>
<?php endif; ?>

<div class="feed">
    <?php foreach ($posts as $post): ?>
        <article class="card">
            <a href="/media/<?= (int) $post['id'] ?>" class="imglink">
                <img src="/media/<?= (int) $post['id'] ?>" alt="Photo by <?= e($post['username']) ?>" loading="lazy">
            </a>
            <div class="card-body">
                <?php if ($post['caption'] !== ''): ?>
                    <p class="caption"><?= nl2br(e($post['caption'])) ?></p>
                <?php endif; ?>
                <p class="meta">
                    by <strong>@<?= e($post['username']) ?></strong>
                    · <time><?= e($post['created_at']) ?> UTC</time>
                </p>
                <?php if ($user && (int) $user['id'] === (int) $post['user_id']): ?>
                    <div class="actions">
                        <a href="/posts/edit?id=<?= (int) $post['id'] ?>">Edit</a>
                        <form method="post" action="/posts/delete" class="inline">
                            <?= csrf_field() ?>
                            <input type="hidden" name="id" value="<?= (int) $post['id'] ?>">
                            <button type="submit" class="linkbtn danger">Delete</button>
                        </form>
                    </div>
                <?php endif; ?>
            </div>
        </article>
    <?php endforeach; ?>
</div>
