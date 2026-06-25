<section class="auth-panel">
    <h1>Create account</h1>
    <?php require BASE_PATH . '/views/partials/errors.php'; ?>
    <form method="post" action="/register">
        <label>Name
            <input type="text" name="name" value="<?= e(old($input, 'name')) ?>" required>
        </label>
        <label>Email
            <input type="email" name="email" value="<?= e(old($input, 'email')) ?>" required>
        </label>
        <label>Password
            <input type="password" name="password" minlength="8" required>
        </label>
        <button type="submit">Create account</button>
    </form>
    <p>Already registered? <a href="/login">Log in</a></p>
</section>
