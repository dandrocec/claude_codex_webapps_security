<?php
/** @var array<string,mixed> $old */
/** @var string|null $error */
use App\Csrf;
use function App\e;
?>
<h1>Sign in</h1>

<?php if (!empty($error)): ?>
    <div class="flash flash-error"><?= e($error) ?></div>
<?php endif; ?>

<form class="stack" method="post" action="/login">
    <?= Csrf::field() ?>
    <div class="field">
        <label for="email">Email</label>
        <input id="email" type="email" name="email" value="<?= e($old['email'] ?? '') ?>" required autocomplete="email">
    </div>
    <div class="field">
        <label for="password">Password</label>
        <input id="password" type="password" name="password" required autocomplete="current-password">
    </div>
    <button class="btn" type="submit">Sign in</button>
    <p class="hint">No account yet? <a href="/register">Create one</a>.</p>
</form>
