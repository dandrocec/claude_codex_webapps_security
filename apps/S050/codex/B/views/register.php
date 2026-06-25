<?php
use PhotoBlog\Security;
?>
<section class="auth-panel">
  <h1>Create account</h1>
  <form method="post" action="/register">
    <input type="hidden" name="csrf_token" value="<?= Security::e(Security::csrfToken()) ?>">
    <label>Username <input name="username" autocomplete="username" required minlength="3" maxlength="40" pattern="[A-Za-z0-9_.-]+"></label>
    <label>Password <input name="password" type="password" autocomplete="new-password" required minlength="10"></label>
    <button type="submit">Register</button>
  </form>
</section>
