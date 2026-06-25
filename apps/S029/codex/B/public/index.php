<?php

declare(strict_types=1);

use Guestbook\App;
use Guestbook\Auth;
use Guestbook\Csrf;
use Guestbook\Database;
use Guestbook\Http;
use Guestbook\Security;
use Guestbook\Validation;

require dirname(__DIR__) . '/src/bootstrap.php';

$pdo = Database::connection();
$errors = [];
$old = [];
$route = $_GET['action'] ?? 'home';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    if ($method === 'POST') {
        Csrf::verify($_POST['csrf_token'] ?? null);
    }

    if ($route === 'register' && $method === 'POST') {
        [$email, $password] = Validation::credentials($_POST);
        Auth::register($pdo, $email, $password);
        Http::redirect('/');
    }

    if ($route === 'login' && $method === 'POST') {
        [$email, $password] = Validation::credentials($_POST);
        if (!Auth::login($pdo, $email, $password)) {
            throw new RuntimeException('Invalid email or password.');
        }
        Http::redirect('/');
    }

    if ($route === 'logout' && $method === 'POST') {
        Auth::logout();
        Http::redirect('/');
    }

    if ($route === 'message' && $method === 'POST') {
        Auth::requireUser();
        [$displayName, $message] = Validation::message($_POST);
        $stmt = $pdo->prepare(
            'INSERT INTO messages (user_id, display_name, body, created_at) VALUES (:user_id, :display_name, :body, :created_at)'
        );
        $stmt->execute([
            ':user_id' => Auth::userId(),
            ':display_name' => $displayName,
            ':body' => $message,
            ':created_at' => gmdate('c'),
        ]);
        Http::redirect('/');
    }

    if ($route === 'delete' && $method === 'POST') {
        Auth::requireUser();
        $messageId = Validation::positiveInt($_POST['message_id'] ?? null, 'Invalid message.');
        $stmt = $pdo->prepare('DELETE FROM messages WHERE id = :id AND user_id = :user_id');
        $stmt->execute([
            ':id' => $messageId,
            ':user_id' => Auth::userId(),
        ]);
        Http::redirect('/');
    }
} catch (Throwable $exception) {
    $errors[] = App::isDevelopment() ? $exception->getMessage() : 'The request could not be completed.';
    $old = $_POST;
}

$messages = $pdo
    ->query('SELECT messages.id, messages.user_id, messages.display_name, messages.body, messages.created_at, users.email FROM messages JOIN users ON users.id = messages.user_id ORDER BY datetime(messages.created_at) DESC, messages.id DESC')
    ->fetchAll();

$user = Auth::user($pdo);

require dirname(__DIR__) . '/views/layout.php';
