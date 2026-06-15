<?php
/** @var array<string,string> $errors */
/** @var array<string,string> $old */
use App\Security;
?>
<section class="card auth-card">
    <h1>Sign in</h1>

    <form method="post" action="/login" novalidate>
        <input type="hidden" name="csrf_token" value="<?= $e(Security::csrfToken()) ?>">

        <div class="field">
            <label for="email">Email</label>
            <input type="email" id="email" name="email" autocomplete="username"
                   value="<?= $e($old['email'] ?? '') ?>" required maxlength="255">
            <?php if (!empty($errors['email'])): ?>
                <p class="error"><?= $e($errors['email']) ?></p>
            <?php endif; ?>
        </div>

        <div class="field">
            <label for="password">Password</label>
            <input type="password" id="password" name="password" autocomplete="current-password" required>
        </div>

        <button type="submit" class="btn btn-primary">Sign in</button>
    </form>

    <p class="muted">No account? <a href="/register">Create one</a>.</p>
</section>
