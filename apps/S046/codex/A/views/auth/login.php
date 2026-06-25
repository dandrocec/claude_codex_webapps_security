<section class="auth-panel">
    <h1>Login</h1>
    <form method="post" action="/login">
        <label for="email">Email</label>
        <input id="email" type="email" name="email" value="<?= e(old('email')) ?>" required>

        <label for="password">Password</label>
        <input id="password" type="password" name="password" required>

        <button class="button" type="submit">Login</button>
    </form>
</section>
