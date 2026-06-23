<?php

declare(strict_types=1);

use App\Auth;
use App\Database;

// Use Composer's autoloader when available; otherwise fall back to a minimal
// PSR-4 autoloader so the app runs even before `composer install`.
$autoload = dirname(__DIR__) . '/vendor/autoload.php';
if (is_file($autoload)) {
    require $autoload;
} else {
    spl_autoload_register(function (string $class): void {
        if (str_starts_with($class, 'App\\')) {
            $file = dirname(__DIR__) . '/src/' . str_replace('\\', '/', substr($class, 4)) . '.php';
            if (is_file($file)) {
                require $file;
            }
        }
    });
}
require dirname(__DIR__) . '/src/helpers.php';

Auth::start();

$pdo    = Database::pdo();
$method = $_SERVER['REQUEST_METHOD'];
$path   = rtrim(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/', '/');
if ($path === '') {
    $path = '/';
}

/** Require a logged-in user, redirecting to login otherwise. */
$requireLogin = function () {
    if (!Auth::check()) {
        redirect('/login');
    }
};

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

// Home: list of boards.
if ($path === '/' && $method === 'GET') {
    $boards = $pdo->query(
        'SELECT b.*,
                (SELECT COUNT(*) FROM threads t WHERE t.board_id = b.id) AS thread_count
           FROM boards b
          ORDER BY b.id'
    )->fetchAll();
    view('home', ['boards' => $boards]);
    return;
}

// Registration.
if ($path === '/register') {
    if ($method === 'POST') {
        csrf_verify();
        [$ok, $error] = Auth::register($_POST['username'] ?? '', $_POST['password'] ?? '');
        if ($ok) {
            redirect('/');
        }
        view('register', ['error' => $error, 'username' => $_POST['username'] ?? '']);
        return;
    }
    view('register', ['error' => null, 'username' => '']);
    return;
}

// Login.
if ($path === '/login') {
    if ($method === 'POST') {
        csrf_verify();
        if (Auth::login($_POST['username'] ?? '', $_POST['password'] ?? '')) {
            redirect('/');
        }
        view('login', ['error' => 'Invalid username or password.', 'username' => $_POST['username'] ?? '']);
        return;
    }
    view('login', ['error' => null, 'username' => '']);
    return;
}

// Logout.
if ($path === '/logout' && $method === 'POST') {
    csrf_verify();
    Auth::logout();
    redirect('/');
}

// View a board: threads newest-first with reply counts.
if (preg_match('#^/board/(\d+)$#', $path, $m) && $method === 'GET') {
    $board = $pdo->prepare('SELECT * FROM boards WHERE id = ?');
    $board->execute([$m[1]]);
    $board = $board->fetch();
    if (!$board) {
        http_response_code(404);
        view('error', ['message' => 'Board not found.']);
        return;
    }

    $stmt = $pdo->prepare(
        'SELECT t.*,
                u.username AS author,
                (SELECT COUNT(*) FROM replies r WHERE r.thread_id = t.id) AS reply_count
           FROM threads t
           LEFT JOIN users u ON u.id = t.user_id
          WHERE t.board_id = ?
          ORDER BY t.created_at DESC, t.id DESC'
    );
    $stmt->execute([$board['id']]);
    view('board', ['board' => $board, 'threads' => $stmt->fetchAll()]);
    return;
}

// New thread form + submission.
if (preg_match('#^/board/(\d+)/new$#', $path, $m)) {
    $requireLogin();
    $board = $pdo->prepare('SELECT * FROM boards WHERE id = ?');
    $board->execute([$m[1]]);
    $board = $board->fetch();
    if (!$board) {
        http_response_code(404);
        view('error', ['message' => 'Board not found.']);
        return;
    }

    if ($method === 'POST') {
        csrf_verify();
        $title = trim($_POST['title'] ?? '');
        $body  = trim($_POST['body'] ?? '');
        if ($title === '' || $body === '') {
            view('new_thread', ['board' => $board, 'error' => 'Title and body are required.', 'title' => $title, 'body' => $body]);
            return;
        }
        $stmt = $pdo->prepare('INSERT INTO threads (board_id, user_id, title, body) VALUES (?, ?, ?, ?)');
        $stmt->execute([$board['id'], Auth::user()['id'], $title, $body]);
        redirect('/thread/' . $pdo->lastInsertId());
    }

    view('new_thread', ['board' => $board, 'error' => null, 'title' => '', 'body' => '']);
    return;
}

// View a thread with its replies.
if (preg_match('#^/thread/(\d+)$#', $path, $m) && $method === 'GET') {
    $stmt = $pdo->prepare(
        'SELECT t.*, u.username AS author, b.name AS board_name
           FROM threads t
           LEFT JOIN users u ON u.id = t.user_id
           JOIN boards b ON b.id = t.board_id
          WHERE t.id = ?'
    );
    $stmt->execute([$m[1]]);
    $thread = $stmt->fetch();
    if (!$thread) {
        http_response_code(404);
        view('error', ['message' => 'Thread not found.']);
        return;
    }

    $replies = $pdo->prepare(
        'SELECT r.*, u.username AS author
           FROM replies r
           LEFT JOIN users u ON u.id = r.user_id
          WHERE r.thread_id = ?
          ORDER BY r.created_at ASC, r.id ASC'
    );
    $replies->execute([$thread['id']]);
    view('thread', ['thread' => $thread, 'replies' => $replies->fetchAll()]);
    return;
}

// Post a reply.
if (preg_match('#^/thread/(\d+)/reply$#', $path, $m) && $method === 'POST') {
    $requireLogin();
    csrf_verify();
    $exists = $pdo->prepare('SELECT 1 FROM threads WHERE id = ?');
    $exists->execute([$m[1]]);
    if (!$exists->fetchColumn()) {
        http_response_code(404);
        view('error', ['message' => 'Thread not found.']);
        return;
    }
    $body = trim($_POST['body'] ?? '');
    if ($body !== '') {
        $stmt = $pdo->prepare('INSERT INTO replies (thread_id, user_id, body) VALUES (?, ?, ?)');
        $stmt->execute([$m[1], Auth::user()['id'], $body]);
    }
    redirect('/thread/' . $m[1] . '#replies');
}

// Delete a thread (moderator or the thread's author).
if (preg_match('#^/thread/(\d+)/delete$#', $path, $m) && $method === 'POST') {
    $requireLogin();
    csrf_verify();
    $stmt = $pdo->prepare('SELECT * FROM threads WHERE id = ?');
    $stmt->execute([$m[1]]);
    $thread = $stmt->fetch();
    if ($thread && canDelete($thread['user_id'])) {
        $pdo->prepare('DELETE FROM threads WHERE id = ?')->execute([$thread['id']]);
        redirect('/board/' . $thread['board_id']);
    }
    http_response_code(403);
    view('error', ['message' => 'You are not allowed to delete this thread.']);
    return;
}

// Delete a reply (moderator or the reply's author).
if (preg_match('#^/reply/(\d+)/delete$#', $path, $m) && $method === 'POST') {
    $requireLogin();
    csrf_verify();
    $stmt = $pdo->prepare('SELECT * FROM replies WHERE id = ?');
    $stmt->execute([$m[1]]);
    $reply = $stmt->fetch();
    if ($reply && canDelete($reply['user_id'])) {
        $pdo->prepare('DELETE FROM replies WHERE id = ?')->execute([$reply['id']]);
        redirect('/thread/' . $reply['thread_id'] . '#replies');
    }
    http_response_code(403);
    view('error', ['message' => 'You are not allowed to delete this reply.']);
    return;
}

// Fallback: 404.
http_response_code(404);
view('error', ['message' => 'Page not found.']);

/** A post can be deleted by a moderator or by its own author. */
function canDelete(?int $authorId): bool
{
    if (Auth::isModerator()) {
        return true;
    }
    $user = Auth::user();
    return $user !== null && $authorId !== null && (int) $user['id'] === (int) $authorId;
}
