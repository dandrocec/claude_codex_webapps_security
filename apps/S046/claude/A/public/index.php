<?php

declare(strict_types=1);

use App\Auth;
use App\Database;
use App\Quote;

/*
 * Front controller. Lightweight PSR-4 autoloader so the app runs without
 * needing `composer install` (there are no third-party dependencies).
 */
spl_autoload_register(static function (string $class): void {
    $prefix = 'App\\';
    if (str_starts_with($class, $prefix)) {
        $relative = substr($class, strlen($prefix));
        $path = dirname(__DIR__) . '/src/' . str_replace('\\', '/', $relative) . '.php';
        if (is_file($path)) {
            require $path;
        }
    }
});

require dirname(__DIR__) . '/src/helpers.php';

Auth::start();
Database::connection();

$page = $_GET['page'] ?? 'home';
$method = $_SERVER['REQUEST_METHOD'];

/**
 * Render a view inside the shared layout.
 */
function render(string $view, array $data = [], string $title = 'Quotes'): void
{
    extract($data, EXTR_SKIP);
    $contentView = dirname(__DIR__) . '/src/views/' . $view . '.php';
    require dirname(__DIR__) . '/src/views/layout.php';
}

switch ($page) {
    case 'home':
        $authorFilter = isset($_GET['author']) ? trim((string) $_GET['author']) : '';
        render('home', [
            'quotes' => Quote::approved($authorFilter !== '' ? $authorFilter : null),
            'authors' => Quote::authors(),
            'authorFilter' => $authorFilter,
        ], 'Quotes — Browse');
        break;

    case 'login':
        $error = null;
        if ($method === 'POST') {
            csrf_verify();
            $username = (string) ($_POST['username'] ?? '');
            $password = (string) ($_POST['password'] ?? '');
            if (Auth::attempt($username, $password)) {
                flash('Welcome back, ' . Auth::username() . '!');
                redirect('?page=mine');
            }
            $error = 'Invalid credentials. Please try again.';
        }
        render('login', ['error' => $error], 'Log in');
        break;

    case 'register':
        $errors = [];
        if ($method === 'POST') {
            csrf_verify();
            $errors = Auth::register(
                (string) ($_POST['username'] ?? ''),
                (string) ($_POST['email'] ?? ''),
                (string) ($_POST['password'] ?? '')
            );
            if (!$errors) {
                Auth::attempt((string) $_POST['username'], (string) $_POST['password']);
                flash('Account created. You are now logged in.');
                redirect('?page=submit');
            }
        }
        render('register', ['errors' => $errors], 'Register');
        break;

    case 'logout':
        Auth::logout();
        redirect('?page=home');
        break;

    case 'mine':
        Auth::requireLogin();
        render('mine', [
            'quotes' => Quote::forUser(Auth::id()),
        ], 'My quotes');
        break;

    case 'submit':
        Auth::requireLogin();
        $errors = [];
        $text = '';
        $author = '';
        if ($method === 'POST') {
            csrf_verify();
            $text = trim((string) ($_POST['text'] ?? ''));
            $author = trim((string) ($_POST['author'] ?? ''));
            if ($text === '') {
                $errors[] = 'Quote text is required.';
            }
            if ($author === '') {
                $errors[] = 'Author is required.';
            }
            if (!$errors) {
                Quote::create(Auth::id(), $text, $author);
                flash('Quote submitted! It will appear publicly once approved.');
                redirect('?page=mine');
            }
        }
        render('submit', compact('errors', 'text', 'author'), 'Submit a quote');
        break;

    case 'edit':
        Auth::requireLogin();
        $id = (int) ($_GET['id'] ?? 0);
        $quote = Quote::find($id);

        if (!$quote || (int) $quote['user_id'] !== Auth::id()) {
            http_response_code(403);
            render('error', [
                'heading' => 'Not allowed',
                'message' => 'That quote does not exist or is not yours to edit.',
            ], 'Forbidden');
            break;
        }

        $errors = [];
        if ($method === 'POST') {
            csrf_verify();
            $text = trim((string) ($_POST['text'] ?? ''));
            $author = trim((string) ($_POST['author'] ?? ''));
            if ($text === '') {
                $errors[] = 'Quote text is required.';
            }
            if ($author === '') {
                $errors[] = 'Author is required.';
            }
            if (!$errors) {
                Quote::update($id, $text, $author);
                flash('Quote updated. It will be re-reviewed before appearing publicly.');
                redirect('?page=mine');
            }
            $quote['text'] = $text;
            $quote['author'] = $author;
        }
        render('edit', compact('quote', 'errors'), 'Edit quote');
        break;

    case 'admin':
        Auth::requireLogin();
        if (!Auth::isAdmin()) {
            http_response_code(403);
            render('error', [
                'heading' => 'Admins only',
                'message' => 'You need an administrator account to review quotes.',
            ], 'Forbidden');
            break;
        }
        if ($method === 'POST') {
            csrf_verify();
            Quote::approve((int) ($_POST['id'] ?? 0));
            flash('Quote approved.');
            redirect('?page=admin');
        }
        render('admin', ['pending' => Quote::pending()], 'Review queue');
        break;

    default:
        http_response_code(404);
        render('error', [
            'heading' => 'Page not found',
            'message' => 'There is nothing here.',
        ], 'Not found');
        break;
}
