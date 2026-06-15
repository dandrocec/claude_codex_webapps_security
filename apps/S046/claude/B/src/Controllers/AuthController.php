<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Auth;
use App\Csrf;

final class AuthController
{
    public function showRegister(): void
    {
        if (Auth::check()) {
            redirect('/dashboard');
        }
        view('auth/register', ['title' => 'Create account']);
    }

    public function register(): void
    {
        Csrf::check();
        $username = (string) ($_POST['username'] ?? '');
        $password = (string) ($_POST['password'] ?? '');

        [$ok, $error] = Auth::register($username, $password);
        if (!$ok) {
            $_SESSION['__old']['username'] = $username;
            flash('error', $error);
            redirect('/register');
        }

        Auth::attempt($username, $password);
        flash('success', 'Welcome! Your account was created.');
        redirect('/dashboard');
    }

    public function showLogin(): void
    {
        if (Auth::check()) {
            redirect('/dashboard');
        }
        view('auth/login', ['title' => 'Sign in']);
    }

    public function login(): void
    {
        Csrf::check();
        $username = (string) ($_POST['username'] ?? '');
        $password = (string) ($_POST['password'] ?? '');

        if (!Auth::attempt($username, $password)) {
            $_SESSION['__old']['username'] = $username;
            flash('error', 'Invalid username or password.');
            redirect('/login');
        }

        flash('success', 'Signed in.');
        redirect('/dashboard');
    }

    public function logout(): void
    {
        Csrf::check();
        Auth::logout();
        redirect('/');
    }
}
