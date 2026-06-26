<section class="auth-panel">
    <h1>Sign in</h1>
    <form method="post" action="/login">
        <input type="hidden" name="csrf_token" value="<?= e($csrf->token()) ?>">
        <label>Email <input type="email" name="email" maxlength="254" required></label>
        <label>Password <input type="password" name="password" minlength="10" maxlength="256" required></label>
        <button type="submit">Sign in</button>
    </form>
</section>
