<?php
declare(strict_types=1);

function register_form(): void
{
    if (is_logged_in()) {
        redirect('/');
    }
    view('register', ['old' => [], 'errors' => []], 'Create an account');
}

function register_submit(): void
{
    require_csrf();

    $email   = strtolower(post('email'));
    $name    = post('display_name');
    $pass    = $_POST['password'] ?? '';
    $confirm = $_POST['password_confirm'] ?? '';

    $errors = [];
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 255) {
        $errors['email'] = 'Enter a valid email address.';
    }
    if (mb_strlen($name) < 2 || mb_strlen($name) > 80) {
        $errors['display_name'] = 'Display name must be 2–80 characters.';
    }
    if (strlen($pass) < 10 || strlen($pass) > 200) {
        $errors['password'] = 'Password must be at least 10 characters.';
    }
    if ($pass !== $confirm) {
        $errors['password_confirm'] = 'Passwords do not match.';
    }

    if (!$errors) {
        $exists = db()->prepare('SELECT 1 FROM users WHERE email = ?');
        $exists->execute([$email]);
        if ($exists->fetch()) {
            $errors['email'] = 'An account with that email already exists.';
        }
    }

    if ($errors) {
        view('register', ['old' => ['email' => $email, 'display_name' => $name], 'errors' => $errors], 'Create an account');
        return;
    }

    $stmt = db()->prepare('INSERT INTO users (email, display_name, password_hash) VALUES (?, ?, ?)');
    $stmt->execute([$email, $name, password_hash_strong($pass)]);

    login_user((int) db()->lastInsertId());
    flash('Welcome! Your account has been created.', 'success');
    redirect('/');
}

function login_form(): void
{
    if (is_logged_in()) {
        redirect('/');
    }
    view('login', ['old' => [], 'error' => null], 'Log in');
}

function login_submit(): void
{
    require_csrf();

    $email = strtolower(post('email'));
    $pass  = $_POST['password'] ?? '';

    $stmt = db()->prepare('SELECT id, password_hash FROM users WHERE email = ?');
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    // Generic message + verify even when user is missing to limit enumeration/timing.
    // The fallback is a valid (dummy) bcrypt hash so verification does real work.
    $hash = $user['password_hash'] ?? '$2y$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';
    if ($user && password_verify($pass, $hash)) {
        if (password_needs_rehash_strong($hash)) {
            $u = db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
            $u->execute([password_hash_strong($pass), $user['id']]);
        }
        login_user((int) $user['id']);
        flash('Logged in successfully.', 'success');
        redirect('/');
    }

    password_verify($pass, $hash); // keep timing consistent on failure
    view('login', ['old' => ['email' => $email], 'error' => 'Invalid email or password.'], 'Log in');
}

function logout(): void
{
    require_csrf();
    logout_user();
    redirect('/');
}
