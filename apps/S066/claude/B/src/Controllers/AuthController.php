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
        view('auth/register', ['title' => 'Register as an agent', 'old' => []]);
    }

    public function register(): void
    {
        Csrf::requireValid();

        $name = clean_text($_POST['name'] ?? '', 80);
        $email = clean_text($_POST['email'] ?? '', 190);
        $password = (string) ($_POST['password'] ?? '');
        $confirm = (string) ($_POST['password_confirm'] ?? '');

        $errors = [];
        if ($name === '') {
            $errors[] = 'Name is required.';
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors[] = 'A valid email address is required.';
        }
        $email = mb_strtolower($email);
        if (strlen($password) < 10) {
            $errors[] = 'Password must be at least 10 characters.';
        }
        if (strlen($password) > 200) {
            $errors[] = 'Password is too long.';
        }
        if ($password !== $confirm) {
            $errors[] = 'Passwords do not match.';
        }

        if ($errors) {
            foreach ($errors as $err) {
                flash('error', $err);
            }
            view('auth/register', [
                'title' => 'Register as an agent',
                'old'   => ['name' => $name, 'email' => $email],
            ], 422);
        }

        [$ok, $error] = Auth::register($name, $email, $password);
        if (!$ok) {
            flash('error', (string) $error);
            view('auth/register', [
                'title' => 'Register as an agent',
                'old'   => ['name' => $name, 'email' => $email],
            ], 422);
        }

        // Log the new agent in.
        Auth::attempt($email, $password);
        flash('success', 'Welcome, ' . $name . '! Your agent account is ready.');
        redirect('/dashboard');
    }

    public function showLogin(): void
    {
        if (Auth::check()) {
            redirect('/dashboard');
        }
        view('auth/login', ['title' => 'Log in', 'old' => []]);
    }

    public function login(): void
    {
        Csrf::requireValid();

        $email = mb_strtolower(clean_text($_POST['email'] ?? '', 190));
        $password = (string) ($_POST['password'] ?? '');

        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || $password === '') {
            flash('error', 'Please enter your email and password.');
            view('auth/login', ['title' => 'Log in', 'old' => ['email' => $email]], 422);
        }

        if (!Auth::attempt($email, $password)) {
            // Generic message — do not reveal whether the email exists.
            flash('error', 'Invalid email or password.');
            view('auth/login', ['title' => 'Log in', 'old' => ['email' => $email]], 401);
        }

        flash('success', 'Logged in successfully.');
        redirect('/dashboard');
    }

    public function logout(): void
    {
        Csrf::requireValid();
        Auth::logout();
        redirect('/');
    }
}
