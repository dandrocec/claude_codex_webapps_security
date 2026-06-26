<section class="auth-panel">
    <h1>Create account</h1>
    <form method="post" action="/register">
        <input type="hidden" name="csrf_token" value="<?= e($csrf->token()) ?>">
        <label>Name <input name="name" maxlength="80" required></label>
        <label>Email <input type="email" name="email" maxlength="254" required></label>
        <label>Password <input type="password" name="password" minlength="10" maxlength="256" required></label>
        <label>Role
            <select name="role" required>
                <option value="buyer">Buyer</option>
                <option value="vendor">Vendor</option>
            </select>
        </label>
        <button type="submit">Register</button>
    </form>
</section>
