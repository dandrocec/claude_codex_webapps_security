<?php
/** @var array<string,mixed> $old */
/** @var array<string,string> $errors */
use App\Csrf;
use function App\e;
$role = $old['role'] ?? 'buyer';
?>
<h1>Create your account</h1>

<form class="stack" method="post" action="/register">
    <?= Csrf::field() ?>
    <div class="field">
        <label for="name">Name</label>
        <input id="name" type="text" name="name" value="<?= e($old['name'] ?? '') ?>" required maxlength="80">
        <?php if (isset($errors['name'])): ?><div class="err"><?= e($errors['name']) ?></div><?php endif; ?>
    </div>
    <div class="field">
        <label for="email">Email</label>
        <input id="email" type="email" name="email" value="<?= e($old['email'] ?? '') ?>" required autocomplete="email">
        <?php if (isset($errors['email'])): ?><div class="err"><?= e($errors['email']) ?></div><?php endif; ?>
    </div>
    <div class="field">
        <label for="role">Account type</label>
        <select id="role" name="role">
            <option value="buyer" <?= $role === 'buyer' ? 'selected' : '' ?>>Buyer — shop across vendors</option>
            <option value="vendor" <?= $role === 'vendor' ? 'selected' : '' ?>>Vendor — sell your products</option>
        </select>
        <?php if (isset($errors['role'])): ?><div class="err"><?= e($errors['role']) ?></div><?php endif; ?>
    </div>
    <div class="field">
        <label for="password">Password</label>
        <input id="password" type="password" name="password" required autocomplete="new-password">
        <div class="hint">At least 10 characters.</div>
        <?php if (isset($errors['password'])): ?><div class="err"><?= e($errors['password']) ?></div><?php endif; ?>
    </div>
    <div class="field">
        <label for="password_confirm">Confirm password</label>
        <input id="password_confirm" type="password" name="password_confirm" required autocomplete="new-password">
        <?php if (isset($errors['password_confirm'])): ?><div class="err"><?= e($errors['password_confirm']) ?></div><?php endif; ?>
    </div>
    <button class="btn" type="submit">Create account</button>
    <p class="hint">Already registered? <a href="/login">Sign in</a>.</p>
</form>
