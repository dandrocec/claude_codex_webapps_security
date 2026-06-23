<?php

use App\Helpers;
?>
<div class="form-card auth-card">
    <h1>Agent login</h1>
    <form action="/login" method="post">
        <div class="form-group">
            <label for="email">Email</label>
            <input type="email" id="email" name="email" required>
        </div>
        <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" name="password" required>
        </div>
        <button type="submit" class="btn">Log in</button>
        <p class="muted" style="margin-bottom:0;">New here? <a href="/register">Become an agent</a>.</p>
    </form>
</div>
