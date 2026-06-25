<section class="auth-panel">
    <h1>Log in</h1>
    <?php require BASE_PATH . '/views/partials/errors.php'; ?>
    <form method="post" action="/login">
        <label>Email
            <input type="email" name="email" value="<?= e(old($input, 'email')) ?>" required>
        </label>
        <label>Password
            <input type="password" name="password" required>
        </label>
        <button type="submit">Log in</button>
    </form>
    <p>Need an account? <a href="/register">Register</a></p>
</section>
