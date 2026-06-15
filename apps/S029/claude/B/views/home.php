<?php
/** @var array $messages @var ?string $flash @var array $old @var array $errors */
$title = 'Guestbook — leave a message';
$old = $old ?? [];
$errors = $errors ?? [];
?>
<section class="card">
    <h1>Sign the guestbook</h1>

    <?php if (!empty($flash)): ?>
        <p class="flash success"><?= e($flash) ?></p>
    <?php endif; ?>

    <form method="post" action="/messages" class="stack" novalidate>
        <?= \App\Csrf::field() ?>

        <label for="author_name">Your name</label>
        <input type="text" id="author_name" name="author_name" maxlength="60" required
               value="<?= e($old['author_name'] ?? (\App\Auth::check() ? \App\Auth::username() : '')) ?>">
        <?php if (isset($errors['author_name'])): ?>
            <span class="field-error"><?= e($errors['author_name']) ?></span>
        <?php endif; ?>

        <label for="body">Message</label>
        <textarea id="body" name="body" rows="4" maxlength="2000" required><?= e($old['body'] ?? '') ?></textarea>
        <?php if (isset($errors['body'])): ?>
            <span class="field-error"><?= e($errors['body']) ?></span>
        <?php endif; ?>

        <button type="submit" class="btn">Post message</button>
        <?php if (!\App\Auth::check()): ?>
            <p class="hint"><a href="/login">Log in</a> or <a href="/register">register</a> if you want to be able to delete your own messages later.</p>
        <?php endif; ?>
    </form>
</section>

<section class="messages">
    <h2><?= count($messages) ?> message<?= count($messages) === 1 ? '' : 's' ?></h2>

    <?php if ($messages === []): ?>
        <p class="empty">No messages yet — be the first to sign!</p>
    <?php endif; ?>

    <?php foreach ($messages as $msg): ?>
        <article class="message">
            <div class="message-head">
                <span class="author"><?= e($msg['author_name']) ?></span>
                <time datetime="<?= e($msg['created_at']) ?>"><?= e($msg['created_at']) ?> UTC</time>
            </div>
            <p class="body"><?= nl2br(e($msg['body'])) ?></p>

            <?php
            $canDelete = \App\Auth::isAdmin()
                || ($msg['user_id'] !== null && (int) $msg['user_id'] === \App\Auth::id());
            ?>
            <?php if ($canDelete): ?>
                <form method="post" action="/messages/<?= (int) $msg['id'] ?>/delete" class="inline">
                    <?= \App\Csrf::field() ?>
                    <button type="submit" class="link-btn danger">Delete</button>
                </form>
            <?php endif; ?>
        </article>
    <?php endforeach; ?>
</section>
