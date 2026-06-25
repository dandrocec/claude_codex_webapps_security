<?php
declare(strict_types=1);

use PhotoBlog\App;
use PhotoBlog\Auth;
use PhotoBlog\Database;
use PhotoBlog\Http;
use PhotoBlog\PostRepository;
use PhotoBlog\Security;
use PhotoBlog\UploadService;

require __DIR__ . '/../src/bootstrap.php';

$app = new App();
$pdo = Database::connect();
$posts = new PostRepository($pdo);
$auth = new Auth($pdo);
$uploader = new UploadService();

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    if ($method === 'GET' && $path === '/') {
        $app->render('feed.php', [
            'posts' => $posts->all(),
            'user' => $auth->user(),
        ]);
        return;
    }

    if ($method === 'GET' && $path === '/register') {
        $app->render('register.php', ['user' => $auth->user()]);
        return;
    }

    if ($method === 'POST' && $path === '/register') {
        Security::verifyCsrf();
        $username = Http::string('username', 3, 40);
        $password = Http::string('password', 10, 200);
        $auth->register($username, $password);
        Http::redirect('/new');
    }

    if ($method === 'GET' && $path === '/login') {
        $app->render('login.php', ['user' => $auth->user()]);
        return;
    }

    if ($method === 'POST' && $path === '/login') {
        Security::verifyCsrf();
        $username = Http::string('username', 3, 40);
        $password = Http::string('password', 1, 200);
        if (!$auth->login($username, $password)) {
            $app->render('login.php', ['error' => 'Invalid username or password.', 'user' => null], 422);
            return;
        }
        Http::redirect('/new');
    }

    if ($method === 'POST' && $path === '/logout') {
        Security::verifyCsrf();
        $auth->logout();
        Http::redirect('/');
    }

    if ($method === 'GET' && $path === '/new') {
        $user = $auth->requireUser();
        $app->render('post_form.php', ['user' => $user, 'post' => null, 'action' => '/posts']);
        return;
    }

    if ($method === 'POST' && $path === '/posts') {
        Security::verifyCsrf();
        $user = $auth->requireUser();
        $caption = Http::string('caption', 1, 500);
        $storedName = $uploader->store($_FILES['image'] ?? null);
        $posts->create((int)$user['id'], $storedName, $caption);
        Http::redirect('/');
    }

    if ($method === 'GET' && preg_match('#^/posts/(\d+)/edit$#', $path, $m)) {
        $user = $auth->requireUser();
        $post = $posts->findOwned((int)$m[1], (int)$user['id']);
        $app->render('post_form.php', ['user' => $user, 'post' => $post, 'action' => '/posts/' . $post['id'] . '/edit']);
        return;
    }

    if ($method === 'POST' && preg_match('#^/posts/(\d+)/edit$#', $path, $m)) {
        Security::verifyCsrf();
        $user = $auth->requireUser();
        $post = $posts->findOwned((int)$m[1], (int)$user['id']);
        $caption = Http::string('caption', 1, 500);
        $newImage = null;
        if (isset($_FILES['image']) && ($_FILES['image']['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE) {
            $newImage = $uploader->store($_FILES['image']);
        }
        $posts->update((int)$post['id'], (int)$user['id'], $caption, $newImage);
        if ($newImage !== null) {
            $uploader->delete($post['image_name']);
        }
        Http::redirect('/');
    }

    if ($method === 'POST' && preg_match('#^/posts/(\d+)/delete$#', $path, $m)) {
        Security::verifyCsrf();
        $user = $auth->requireUser();
        $post = $posts->findOwned((int)$m[1], (int)$user['id']);
        $posts->delete((int)$post['id'], (int)$user['id']);
        $uploader->delete($post['image_name']);
        Http::redirect('/');
    }

    if ($method === 'GET' && $path === '/image') {
        $uploader->serve((string)($_GET['file'] ?? ''));
        return;
    }

    $app->render('error.php', ['message' => 'Page not found.', 'user' => $auth->user()], 404);
} catch (Throwable $e) {
    error_log($e->getMessage());
    $status = in_array((int)$e->getCode(), [400, 401, 403, 404, 413, 422], true) ? (int)$e->getCode() : 500;
    $message = $status === 500 ? 'Something went wrong.' : $e->getMessage();
    $app->render('error.php', ['message' => $message, 'user' => $auth->user()], $status);
}
