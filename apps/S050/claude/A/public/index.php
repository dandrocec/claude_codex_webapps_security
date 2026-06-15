<?php

declare(strict_types=1);

use App\Post;
use App\Uploader;
use App\User;

require dirname(__DIR__) . '/src/bootstrap.php';

// When running under `php -S`, let the built-in server serve real files
// (e.g. uploaded images) directly instead of routing them here.
$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
if (PHP_SAPI === 'cli-server' && $uri !== '/' && is_file(__DIR__ . $uri)) {
    return false;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// ---- Routing -------------------------------------------------------------
// Match "/posts/{id}/..." segments up front for the post routes.
if (preg_match('#^/posts/(\d+)(/edit|/update|/delete)?$#', $uri, $m)) {
    $postId = (int) $m[1];
    $action = $m[2] ?? '';

    if ($method === 'GET' && $action === '/edit') {
        edit_post_form($postId);
    } elseif ($method === 'POST' && $action === '/update') {
        update_post($postId);
    } elseif ($method === 'POST' && $action === '/delete') {
        delete_post($postId);
    } else {
        not_found();
    }
}

switch ("$method $uri") {
    case 'GET /':            show_feed();        break;
    case 'GET /register':    register_form();    break;
    case 'POST /register':   register();         break;
    case 'GET /login':       login_form();       break;
    case 'POST /login':      login();            break;
    case 'POST /logout':     logout();           break;
    case 'GET /posts/new':   new_post_form();    break;
    case 'POST /posts':      create_post();      break;
    default:                 not_found();
}

// ---- Controllers ---------------------------------------------------------

function show_feed(): void
{
    view('feed', [
        'title' => 'Photo Feed',
        'posts' => Post::feed(),
    ]);
}

function register_form(): void
{
    view('register', ['title' => 'Register', 'username' => '', 'error' => null]);
}

function register(): void
{
    verify_csrf();

    $username = trim((string) ($_POST['username'] ?? ''));
    $password = (string) ($_POST['password'] ?? '');

    $error = null;
    if ($username === '' || $password === '') {
        $error = 'Username and password are required.';
    } elseif (strlen($username) > 50) {
        $error = 'Username must be 50 characters or fewer.';
    } elseif (strlen($password) < 6) {
        $error = 'Password must be at least 6 characters.';
    }

    if ($error === null) {
        $id = User::create($username, $password);
        if ($id === null) {
            $error = 'That username is already taken.';
        } else {
            $_SESSION['user'] = ['id' => $id, 'username' => $username];
            flash('Welcome, ' . $username . '!');
            redirect('/');
        }
    }

    view('register', ['title' => 'Register', 'username' => $username, 'error' => $error]);
}

function login_form(): void
{
    view('login', ['title' => 'Log in', 'username' => '', 'error' => null]);
}

function login(): void
{
    verify_csrf();

    $username = trim((string) ($_POST['username'] ?? ''));
    $password = (string) ($_POST['password'] ?? '');

    $user = User::findByUsername($username);
    if ($user === null || !password_verify($password, $user['password_hash'])) {
        view('login', [
            'title'    => 'Log in',
            'username' => $username,
            'error'    => 'Invalid username or password.',
        ]);
    }

    session_regenerate_id(true);
    $_SESSION['user'] = ['id' => (int) $user['id'], 'username' => $user['username']];
    flash('Logged in.');
    redirect('/');
}

function logout(): void
{
    verify_csrf();
    $_SESSION = [];
    session_regenerate_id(true);
    flash('Logged out.');
    redirect('/');
}

function new_post_form(): void
{
    require_login();
    view('post_form', [
        'title'  => 'New Post',
        'post'   => null,
        'error'  => null,
    ]);
}

function create_post(): void
{
    $user = require_login();
    verify_csrf();

    $caption = trim((string) ($_POST['caption'] ?? ''));

    try {
        $imagePath = Uploader::store($_FILES['image'] ?? []);
    } catch (\RuntimeException $e) {
        view('post_form', [
            'title' => 'New Post',
            'post'  => ['caption' => $caption],
            'error' => $e->getMessage(),
        ]);
    }

    Post::create((int) $user['id'], $imagePath, $caption);
    flash('Post published.');
    redirect('/');
}

function edit_post_form(int $id): void
{
    $user = require_login();
    $post = own_post_or_abort($id, (int) $user['id']);

    view('post_form', [
        'title' => 'Edit Post',
        'post'  => $post,
        'error' => null,
    ]);
}

function update_post(int $id): void
{
    $user = require_login();
    verify_csrf();
    $post = own_post_or_abort($id, (int) $user['id']);

    $caption = trim((string) ($_POST['caption'] ?? ''));
    $newImagePath = null;

    // Image is optional on edit; only replace it if a new file came in.
    if (!empty($_FILES['image']['name'])) {
        try {
            $newImagePath = Uploader::store($_FILES['image']);
        } catch (\RuntimeException $e) {
            view('post_form', [
                'title' => 'Edit Post',
                'post'  => ['id' => $id, 'caption' => $caption, 'image_path' => $post['image_path']],
                'error' => $e->getMessage(),
            ]);
        }
    }

    Post::update($id, $caption, $newImagePath);
    if ($newImagePath !== null) {
        Uploader::remove($post['image_path']);
    }

    flash('Post updated.');
    redirect('/');
}

function delete_post(int $id): void
{
    $user = require_login();
    verify_csrf();
    $post = own_post_or_abort($id, (int) $user['id']);

    Post::delete($id);
    Uploader::remove($post['image_path']);

    flash('Post deleted.');
    redirect('/');
}

// ---- Guards / utilities --------------------------------------------------

/**
 * Fetch a post and ensure it belongs to the given user, or abort.
 *
 * @return array<string, mixed>
 */
function own_post_or_abort(int $id, int $userId): array
{
    $post = Post::find($id);
    if ($post === null) {
        not_found();
    }
    if ((int) $post['user_id'] !== $userId) {
        http_response_code(403);
        exit('You can only modify your own posts.');
    }
    return $post;
}

function not_found(): never
{
    http_response_code(404);
    view('not_found', ['title' => 'Not Found']);
}
