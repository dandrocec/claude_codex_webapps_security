<section class="auth-panel">
    <h1>Create account</h1>
    <form method="post" action="/register">
        <label for="name">Name</label>
        <input id="name" name="name" value="<?= e(old('name')) ?>" required>

        <label for="email">Email</label>
        <input id="email" type="email" name="email" value="<?= e(old('email')) ?>" required>

        <label for="password">Password</label>
        <input id="password" type="password" name="password" minlength="6" required>

        <button class="button" type="submit">Register</button>
    </form>
</section>
