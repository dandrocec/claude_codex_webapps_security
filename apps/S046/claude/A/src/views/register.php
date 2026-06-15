<?php /** @var array $errors */ ?>
<h1>Create an account</h1>

<?php foreach ($errors as $error): ?>
    <div class="error"><?= e($error) ?></div>
<?php endforeach; ?>

<form method="post" action="?page=register" class="card-form">
    <?= csrf_field() ?>
    <label>Username
        <input type="text" name="username" value="<?= e($_POST['username'] ?? '') ?>" required autofocus>
    </label>
    <label>Email
        <input type="email" name="email" value="<?= e($_POST['email'] ?? '') ?>" required>
    </label>
    <label>Password
        <input type="password" name="password" required minlength="6">
    </label>
    <button type="submit">Register</button>
</form>

<p class="hint">Already have an account? <a href="?page=login">Log in</a>.</p>
