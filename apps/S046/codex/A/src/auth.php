<?php

declare(strict_types=1);

function currentUser(): ?array
{
    if (empty($_SESSION['user_id'])) {
        return null;
    }

    static $user = null;
    if ($user !== null && (int) $user['id'] === (int) $_SESSION['user_id']) {
        return $user;
    }

    $stmt = db()->prepare('SELECT * FROM users WHERE id = :id');
    $stmt->execute(['id' => (int) $_SESSION['user_id']]);
    $user = $stmt->fetch() ?: null;

    return $user;
}

function requireLogin(): void
{
    if (!currentUser()) {
        flash('Please log in first.', 'error');
        redirect('/login');
    }
}

function requireAdmin(): void
{
    requireLogin();

    if (!(bool) currentUser()['is_admin']) {
        http_response_code(403);
        render('403', ['title' => 'Forbidden']);
        exit;
    }
}

function handleRegister(): void
{
    $name = trim($_POST['name'] ?? '');
    $email = strtolower(trim($_POST['email'] ?? ''));
    $password = $_POST['password'] ?? '';

    if ($name === '' || $email === '' || $password === '') {
        rememberOld(['name' => $name, 'email' => $email]);
        flash('Name, email, and password are required.', 'error');
        redirect('/register');
    }

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        rememberOld(['name' => $name, 'email' => $email]);
        flash('Enter a valid email address.', 'error');
        redirect('/register');
    }

    if (strlen($password) < 6) {
        rememberOld(['name' => $name, 'email' => $email]);
        flash('Password must be at least 6 characters.', 'error');
        redirect('/register');
    }

    try {
        $stmt = db()->prepare(
            'INSERT INTO users (name, email, password_hash) VALUES (:name, :email, :password_hash)'
        );
        $stmt->execute([
            'name' => $name,
            'email' => $email,
            'password_hash' => password_hash($password, PASSWORD_DEFAULT),
        ]);
    } catch (PDOException $exception) {
        rememberOld(['name' => $name, 'email' => $email]);
        flash('That email is already registered.', 'error');
        redirect('/register');
    }

    clearOld();
    $_SESSION['user_id'] = (int) db()->lastInsertId();
    flash('Account created.');
    redirect('/dashboard');
}

function handleLogin(): void
{
    $email = strtolower(trim($_POST['email'] ?? ''));
    $password = $_POST['password'] ?? '';

    $stmt = db()->prepare('SELECT * FROM users WHERE email = :email');
    $stmt->execute(['email' => $email]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        rememberOld(['email' => $email]);
        flash('Invalid email or password.', 'error');
        redirect('/login');
    }

    clearOld();
    session_regenerate_id(true);
    $_SESSION['user_id'] = (int) $user['id'];
    flash('Logged in.');
    redirect('/dashboard');
}

function handleLogout(): void
{
    session_destroy();
    redirect('/');
}

