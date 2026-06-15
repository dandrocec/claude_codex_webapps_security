<?php /** @var ?string $error */ ?>
<section class="card">
    <h1>Admin sign in</h1>
    <p class="muted">Sign in to view the subscriber list.</p>

    <?php if ($error): ?>
        <p class="alert alert-error" role="alert"><?= e($error) ?></p>
    <?php endif; ?>

    <form method="post" action="/admin/login">
        <?= csrf_field() ?>
        <label for="username">Username</label>
        <input type="text" id="username" name="username" autocomplete="username" required>

        <label for="password">Password</label>
        <input type="password" id="password" name="password" autocomplete="current-password" required>

        <button type="submit" class="btn">Sign in</button>
    </form>
</section>
