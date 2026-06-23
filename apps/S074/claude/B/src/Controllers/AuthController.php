<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Auth;
use App\Database;
use App\Http;
use App\Request;
use App\Session;
use App\Validator;
use App\View;

final class AuthController
{
    public function showRegister(): string
    {
        if (Auth::check()) {
            return Http::redirect('/');
        }
        return View::render('auth/register', ['title' => 'Create account', 'old' => [], 'errors' => []]);
    }

    public function register(): string
    {
        if (Auth::check()) {
            return Http::redirect('/');
        }

        $v = new Validator(Request::post());
        $name     = $v->string('name', true, 2, 80);
        $email    = $v->email('email');
        $role     = $v->inList('role', [Auth::ROLE_BUYER, Auth::ROLE_VENDOR]);
        $password = $v->string('password', true, 10, 200);
        $confirm  = $v->string('password_confirm', true, 10, 200);

        if ($password !== null && $confirm !== null && $password !== $confirm) {
            $v->addError('password_confirm', 'Passwords do not match.');
        }

        $old = ['name' => Request::postValue('name'), 'email' => Request::postValue('email'), 'role' => Request::postValue('role')];

        if (!$v->passes()) {
            return View::render('auth/register', [
                'title' => 'Create account', 'old' => $old, 'errors' => $v->errors(),
            ], 422);
        }

        $pdo = Database::connection();
        $exists = $pdo->prepare('SELECT 1 FROM users WHERE email = :email');
        $exists->execute([':email' => $email]);
        if ($exists->fetchColumn() !== false) {
            return View::render('auth/register', [
                'title'  => 'Create account',
                'old'    => $old,
                'errors' => ['email' => 'An account with that email already exists.'],
            ], 422);
        }

        $stmt = $pdo->prepare(
            'INSERT INTO users (name, email, password_hash, role, created_at)
             VALUES (:name, :email, :hash, :role, :ts)'
        );
        $stmt->execute([
            ':name'  => $name,
            ':email' => $email,
            ':hash'  => Auth::hash((string) $password),
            ':role'  => $role,
            ':ts'    => gmdate('c'),
        ]);

        Auth::login([
            'id'    => (int) $pdo->lastInsertId(),
            'email' => (string) $email,
            'name'  => (string) $name,
            'role'  => (string) $role,
        ]);
        Session::flash('Welcome, ' . $name . '! Your account is ready.', 'success');
        return Http::redirect($role === Auth::ROLE_VENDOR ? '/vendor/products' : '/');
    }

    public function showLogin(): string
    {
        if (Auth::check()) {
            return Http::redirect('/');
        }
        return View::render('auth/login', ['title' => 'Sign in', 'old' => [], 'error' => null]);
    }

    public function login(): string
    {
        if (Auth::check()) {
            return Http::redirect('/');
        }

        $email    = (string) Request::postValue('email', '');
        $password = (string) Request::postValue('password', '');

        $user = Auth::attempt($email, $password);
        if ($user === null) {
            // Generic message: do not reveal whether the email exists.
            return View::render('auth/login', [
                'title' => 'Sign in',
                'old'   => ['email' => $email],
                'error' => 'Invalid email or password.',
            ], 401);
        }

        Auth::login($user);
        Session::flash('Signed in successfully.', 'success');
        return Http::redirect($user['role'] === Auth::ROLE_VENDOR ? '/vendor/products' : '/');
    }

    public function logout(): string
    {
        Auth::logout();
        return Http::redirect('/');
    }
}
