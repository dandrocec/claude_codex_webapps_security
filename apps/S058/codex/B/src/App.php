<?php

declare(strict_types=1);

namespace Forum;

use PDO;

final class App
{
    public function __construct(private PDO $db, private Auth $auth, private Csrf $csrf)
    {
    }

    public function home(): void
    {
        $boards = $this->db->query('SELECT b.*, COUNT(t.id) AS thread_count FROM boards b LEFT JOIN threads t ON t.board_id = b.id AND t.deleted_at IS NULL GROUP BY b.id ORDER BY b.name')->fetchAll();
        $html = '<h1>Discussion Forum</h1><div class="board-list">';
        foreach ($boards as $board) {
            $html .= '<a class="board" href="/board/' . (int) $board['id'] . '"><strong>' . Security::e($board['name']) . '</strong><span>' . Security::e($board['description']) . '</span><em>' . (int) $board['thread_count'] . ' threads</em></a>';
        }
        $html .= '</div>';
        echo self::render('Boards', $html, $this->auth->user(), $this->csrf);
    }

    public function board(int $id): void
    {
        $board = $this->findBoard($id);
        if (!$board) {
            $this->notFound();
            return;
        }
        $stmt = $this->db->prepare('
            SELECT t.*, u.username, COUNT(r.id) AS reply_count
            FROM threads t
            JOIN users u ON u.id = t.user_id
            LEFT JOIN replies r ON r.thread_id = t.id AND r.deleted_at IS NULL
            WHERE t.board_id = ? AND t.deleted_at IS NULL
            GROUP BY t.id
            ORDER BY t.created_at DESC
        ');
        $stmt->execute([$id]);
        $threads = $stmt->fetchAll();

        $html = '<div class="title-row"><h1>' . Security::e($board['name']) . '</h1>';
        if ($this->auth->user()) {
            $html .= '<a class="button" href="/thread/new/' . $id . '">New thread</a>';
        }
        $html .= '</div><p>' . Security::e($board['description']) . '</p><div class="thread-list">';
        foreach ($threads as $thread) {
            $html .= '<a class="thread" href="/thread/' . (int) $thread['id'] . '"><strong>' . Security::e($thread['title']) . '</strong><span>by ' . Security::e($thread['username']) . ' on ' . Security::e($thread['created_at']) . '</span><em>' . (int) $thread['reply_count'] . ' replies</em></a>';
        }
        $html .= $threads ? '</div>' : '<p>No threads yet.</p></div>';
        echo self::render($board['name'], $html, $this->auth->user(), $this->csrf);
    }

    public function thread(int $id): void
    {
        $stmt = $this->db->prepare('SELECT t.*, u.username FROM threads t JOIN users u ON u.id = t.user_id WHERE t.id = ? AND t.deleted_at IS NULL');
        $stmt->execute([$id]);
        $thread = $stmt->fetch();
        if (!$thread) {
            $this->notFound();
            return;
        }
        $replies = $this->replies($id);
        $user = $this->auth->user();
        $canDelete = $this->auth->isModerator($user);

        $html = '<article class="post"><h1>' . Security::e($thread['title']) . '</h1><p class="meta">by ' . Security::e($thread['username']) . ' on ' . Security::e($thread['created_at']) . '</p><div>' . nl2br(Security::e($thread['body'])) . '</div>';
        if ($canDelete) {
            $html .= $this->deleteForm('thread', (int) $thread['id']);
        }
        $html .= '</article><h2>Replies</h2>';
        foreach ($replies as $reply) {
            $html .= '<article class="post reply"><p class="meta">by ' . Security::e($reply['username']) . ' on ' . Security::e($reply['created_at']) . '</p><div>' . nl2br(Security::e($reply['body'])) . '</div>';
            if ($canDelete) {
                $html .= $this->deleteForm('reply', (int) $reply['id']);
            }
            $html .= '</article>';
        }
        if ($user) {
            $html .= '<h2>Reply</h2><form method="post" action="/reply/create">' . $this->csrf->field() . '<input type="hidden" name="thread_id" value="' . (int) $id . '"><label>Message<textarea name="body" maxlength="5000" required></textarea></label><button>Post reply</button></form>';
        } else {
            $html .= '<p><a href="/login">Log in</a> to reply.</p>';
        }
        echo self::render($thread['title'], $html, $user, $this->csrf);
    }

    public function newThreadForm(int $boardId, string $error = ''): void
    {
        $this->auth->requireUser();
        $board = $this->findBoard($boardId);
        if (!$board) {
            $this->notFound();
            return;
        }
        $html = '<h1>New thread in ' . Security::e($board['name']) . '</h1>' . $this->error($error) . '<form method="post" action="/thread/create">' . $this->csrf->field() . '<input type="hidden" name="board_id" value="' . $boardId . '"><label>Title<input name="title" maxlength="120" required></label><label>Message<textarea name="body" maxlength="5000" required></textarea></label><button>Create thread</button></form>';
        echo self::render('New thread', $html, $this->auth->user(), $this->csrf);
    }

    public function createThread(): void
    {
        $user = $this->auth->requireUser();
        $boardId = Validation::id($_POST['board_id'] ?? null);
        $title = Validation::string($_POST['title'] ?? '', 120);
        $body = Validation::string($_POST['body'] ?? '', 5000);
        if (!$this->findBoard($boardId) || strlen($title) < 3 || strlen($body) < 3) {
            $this->newThreadForm($boardId, 'Enter a valid title and message.');
            return;
        }
        $stmt = $this->db->prepare('INSERT INTO threads (board_id, user_id, title, body) VALUES (?, ?, ?, ?)');
        $stmt->execute([$boardId, (int) $user['id'], $title, $body]);
        Security::redirect('/thread/' . (int) $this->db->lastInsertId());
    }

    public function createReply(): void
    {
        $user = $this->auth->requireUser();
        $threadId = Validation::id($_POST['thread_id'] ?? null);
        $body = Validation::string($_POST['body'] ?? '', 5000);
        if (!$this->threadExists($threadId) || strlen($body) < 2) {
            Security::redirect('/');
        }
        $stmt = $this->db->prepare('INSERT INTO replies (thread_id, user_id, body) VALUES (?, ?, ?)');
        $stmt->execute([$threadId, (int) $user['id'], $body]);
        Security::redirect('/thread/' . $threadId);
    }

    public function deletePost(): void
    {
        $user = $this->auth->requireUser();
        if (!$this->auth->isModerator($user)) {
            http_response_code(403);
            echo self::render('Forbidden', '<p>You are not allowed to do that.</p>', $user, $this->csrf);
            return;
        }

        $type = Validation::string($_POST['type'] ?? '', 10);
        $id = Validation::id($_POST['id'] ?? null);
        if ($type === 'thread') {
            $stmt = $this->db->prepare('UPDATE threads SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?');
            $stmt->execute([$id]);
            Security::redirect('/');
        }
        if ($type === 'reply') {
            $threadStmt = $this->db->prepare('SELECT thread_id FROM replies WHERE id = ?');
            $threadStmt->execute([$id]);
            $threadId = (int) ($threadStmt->fetchColumn() ?: 0);
            $stmt = $this->db->prepare('UPDATE replies SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?');
            $stmt->execute([$id]);
            Security::redirect($threadId ? '/thread/' . $threadId : '/');
        }
        $this->notFound();
    }

    public function registerForm(string $error = ''): void
    {
        $html = '<h1>Register</h1>' . $this->error($error) . '<form method="post" action="/register">' . $this->csrf->field() . '<label>Username<input name="username" maxlength="32" autocomplete="username" required></label><label>Password<input type="password" name="password" minlength="10" autocomplete="new-password" required></label><button>Create account</button></form>';
        echo self::render('Register', $html, $this->auth->user(), $this->csrf);
    }

    public function register(): void
    {
        $username = Validation::username($_POST['username'] ?? '');
        $password = Validation::password($_POST['password'] ?? '');
        if (!$username || !$password) {
            $this->registerForm('Use 3-32 letters, numbers, or underscores and a password of at least 10 characters.');
            return;
        }
        if (!$this->auth->register($username, $password)) {
            $this->registerForm('That username is unavailable.');
            return;
        }
        Security::redirect('/');
    }

    public function loginForm(string $error = ''): void
    {
        $html = '<h1>Log in</h1>' . $this->error($error) . '<form method="post" action="/login">' . $this->csrf->field() . '<label>Username<input name="username" maxlength="32" autocomplete="username" required></label><label>Password<input type="password" name="password" autocomplete="current-password" required></label><button>Log in</button></form>';
        echo self::render('Log in', $html, $this->auth->user(), $this->csrf);
    }

    public function login(): void
    {
        $username = Validation::username($_POST['username'] ?? '');
        $password = is_string($_POST['password'] ?? null) ? $_POST['password'] : '';
        if (!$username || !$this->auth->login($username, $password)) {
            $this->loginForm('Invalid username or password.');
            return;
        }
        Security::redirect('/');
    }

    public function logout(): void
    {
        $this->auth->logout();
        Security::redirect('/');
    }

    public function notFound(): void
    {
        http_response_code(404);
        echo self::render('Not found', '<p>Page not found.</p>', $this->auth->user(), $this->csrf);
    }

    public function methodNotAllowed(): void
    {
        http_response_code(405);
        echo self::render('Method not allowed', '<p>Method not allowed.</p>', $this->auth->user(), $this->csrf);
    }

    public static function render(string $title, string $body, ?array $user, Csrf $csrf): string
    {
        $nav = '<a href="/">Boards</a>';
        if ($user) {
            $nav .= '<span>Signed in as ' . Security::e($user['username']) . ' (' . Security::e($user['role']) . ')</span><form class="nav-form" method="post" action="/logout">' . $csrf->field() . '<button>Log out</button></form>';
        } else {
            $nav .= '<a href="/login">Log in</a><a href="/register">Register</a>';
        }
        return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' . Security::e($title) . '</title><link rel="stylesheet" href="/style.css"></head><body><header><nav>' . $nav . '</nav></header><main>' . $body . '</main></body></html>';
    }

    private function findBoard(int $id): ?array
    {
        $stmt = $this->db->prepare('SELECT * FROM boards WHERE id = ?');
        $stmt->execute([$id]);
        $board = $stmt->fetch();
        return $board ?: null;
    }

    private function threadExists(int $id): bool
    {
        $stmt = $this->db->prepare('SELECT 1 FROM threads WHERE id = ? AND deleted_at IS NULL');
        $stmt->execute([$id]);
        return (bool) $stmt->fetchColumn();
    }

    private function replies(int $threadId): array
    {
        $stmt = $this->db->prepare('SELECT r.*, u.username FROM replies r JOIN users u ON u.id = r.user_id WHERE r.thread_id = ? AND r.deleted_at IS NULL ORDER BY r.created_at ASC');
        $stmt->execute([$threadId]);
        return $stmt->fetchAll();
    }

    private function deleteForm(string $type, int $id): string
    {
        return '<form class="inline" method="post" action="/post/delete">' . $this->csrf->field() . '<input type="hidden" name="type" value="' . Security::e($type) . '"><input type="hidden" name="id" value="' . $id . '"><button class="danger">Delete</button></form>';
    }

    private function error(string $message): string
    {
        return $message === '' ? '' : '<p class="error">' . Security::e($message) . '</p>';
    }
}
