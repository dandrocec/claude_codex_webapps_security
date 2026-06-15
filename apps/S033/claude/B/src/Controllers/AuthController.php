<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Auth;
use App\Database;
use App\Flash;
use App\Http;
use App\UserRepository;
use App\Validator;
use App\View;

final class AuthController
{
    private UserRepository $users;

    public function __construct()
    {
        $this->users = new UserRepository(Database::connection());
    }

    public function showRegister(): void
    {
        if (Auth::check()) {
            Http::redirect('/contacts');
        }

        echo View::render('register', [
            'title' => 'Create account',
            'errors' => [],
            'old' => ['email' => ''],
        ]);
    }

    public function register(array $post): void
    {
        Http::assertCsrf($post);

        if (Auth::check()) {
            Http::redirect('/contacts');
        }

        $email = Validator::str($post, 'email');
        $password = is_string($post['password'] ?? null) ? $post['password'] : '';
        $confirm = is_string($post['password_confirm'] ?? null) ? $post['password_confirm'] : '';

        $v = new Validator();
        $v->email('email', $email, 'Email');
        $v->passwordStrength('password', $password);

        if (!$v->fails() && $password !== $confirm) {
            $v->addError('password_confirm', 'Passwords do not match.');
        }

        if (!$v->fails() && $this->users->emailExists($v->value('email'))) {
            $v->addError('email', 'An account with that email already exists.');
        }

        if ($v->fails()) {
            echo View::render('register', [
                'title' => 'Create account',
                'errors' => $v->errors(),
                'old' => ['email' => $email ?? ''],
            ], 422);

            return;
        }

        $userId = $this->users->create($v->value('email'), Auth::hashPassword($password));
        Auth::login($userId, $v->value('email'));
        Flash::set('success', 'Welcome! Your account is ready.');
        Http::redirect('/contacts');
    }

    public function showLogin(): void
    {
        if (Auth::check()) {
            Http::redirect('/contacts');
        }

        echo View::render('login', [
            'title' => 'Sign in',
            'errors' => [],
            'old' => ['email' => ''],
        ]);
    }

    public function login(array $post): void
    {
        Http::assertCsrf($post);

        $email = Validator::str($post, 'email') ?? '';
        $password = is_string($post['password'] ?? null) ? $post['password'] : '';

        $user = $email !== '' ? $this->users->findByEmail($email) : null;

        // Always run a verification to keep timing roughly constant and avoid
        // revealing whether the email exists.
        $hash = $user['password_hash'] ?? '$2y$12$usesomesillystringforsalt0000000000000000000000000000000';
        $valid = Auth::verifyPassword($password, (string) $hash);

        if ($user === null || !$valid) {
            // Single generic message — never disclose which field was wrong.
            echo View::render('login', [
                'title' => 'Sign in',
                'errors' => ['email' => 'Invalid email or password.'],
                'old' => ['email' => $email],
            ], 401);

            return;
        }

        if (Auth::needsRehash((string) $user['password_hash'])) {
            $this->users->updatePasswordHash((int) $user['id'], Auth::hashPassword($password));
        }

        Auth::login((int) $user['id'], (string) $user['email']);
        Flash::set('success', 'Signed in successfully.');
        Http::redirect('/contacts');
    }

    public function logout(array $post): void
    {
        Http::assertCsrf($post);
        Auth::logout();
        Flash::set('success', 'You have been signed out.');
        Http::redirect('/login');
    }
}
