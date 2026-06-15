<?php
/** @var array<string,string> $errors */
/** @var array<string,string> $old */
use App\Security;
?>
<section class="card auth-card">
    <h1>Create account</h1>

    <form method="post" action="/register" novalidate>
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
            <input type="password" id="password" name="password" autocomplete="new-password" required>
            <p class="hint">At least 10 characters.</p>
            <?php if (!empty($errors['password'])): ?>
                <p class="error"><?= $e($errors['password']) ?></p>
            <?php endif; ?>
        </div>

        <div class="field">
            <label for="password_confirm">Confirm password</label>
            <input type="password" id="password_confirm" name="password_confirm" autocomplete="new-password" required>
            <?php if (!empty($errors['password_confirm'])): ?>
                <p class="error"><?= $e($errors['password_confirm']) ?></p>
            <?php endif; ?>
        </div>

        <button type="submit" class="btn btn-primary">Create account</button>
    </form>

    <p class="muted">Already registered? <a href="/login">Sign in</a>.</p>
</section>
