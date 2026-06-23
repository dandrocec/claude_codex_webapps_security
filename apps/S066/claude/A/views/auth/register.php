<?php

use App\Helpers;
?>
<div class="form-card auth-card">
    <h1>Become an agent</h1>
    <p class="muted">Create an account to post and manage property listings.</p>
    <form action="/register" method="post">
        <div class="form-group">
            <label for="name">Full name</label>
            <input type="text" id="name" name="name" required>
        </div>
        <div class="form-group">
            <label for="email">Email</label>
            <input type="email" id="email" name="email" required>
        </div>
        <div class="form-group">
            <label for="phone">Phone (shown to visitors)</label>
            <input type="text" id="phone" name="phone">
        </div>
        <div class="form-group">
            <label for="password">Password (min 6 characters)</label>
            <input type="password" id="password" name="password" minlength="6" required>
        </div>
        <button type="submit" class="btn">Create account</button>
        <p class="muted" style="margin-bottom:0;">Already have one? <a href="/login">Log in</a>.</p>
    </form>
</div>
