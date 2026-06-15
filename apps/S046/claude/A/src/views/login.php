<?php /** @var ?string $error */ ?>
<h1>Log in</h1>

<?php if ($error): ?>
    <div class="error"><?= e($error) ?></div>
<?php endif; ?>

<form method="post" action="?page=login" class="card-form">
    <?= csrf_field() ?>
    <label>Username or email
        <input type="text" name="username" required autofocus>
    </label>
    <label>Password
        <input type="password" name="password" required>
    </label>
    <button type="submit">Log in</button>
</form>

<p class="hint">No account? <a href="?page=register">Register</a>.</p>
<p class="hint">Demo logins: <code>admin / admin123</code> or <code>alice / alice123</code>.</p>
