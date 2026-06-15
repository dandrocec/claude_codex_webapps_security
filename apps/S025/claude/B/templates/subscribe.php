<?php /** @var ?string $success @var ?string $error @var string $old */ ?>
<section class="card">
    <h1>Subscribe to our newsletter</h1>
    <p class="muted">Get occasional updates. No spam, unsubscribe anytime.</p>

    <?php if ($success): ?>
        <p class="alert alert-success" role="status"><?= e($success) ?></p>
    <?php endif; ?>
    <?php if ($error): ?>
        <p class="alert alert-error" role="alert"><?= e($error) ?></p>
    <?php endif; ?>

    <form method="post" action="/subscribe" novalidate>
        <?= csrf_field() ?>
        <label for="email">Email address</label>
        <input
            type="email"
            id="email"
            name="email"
            value="<?= e($old) ?>"
            placeholder="you@example.com"
            maxlength="254"
            autocomplete="email"
            required>
        <button type="submit" class="btn">Subscribe</button>
    </form>
</section>
