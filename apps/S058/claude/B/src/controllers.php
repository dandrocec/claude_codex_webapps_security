<?php
declare(strict_types=1);

/**
 * Controllers. Each function handles one route. All state-changing routes
 * require POST + a valid CSRF token + an authenticated user, and enforce
 * resource-level access control.
 */

/* ----------------------------- Boards / Home ----------------------------- */

function home_controller(): void
{
    $boards = db()->query(
        'SELECT b.id, b.name, b.description,
                (SELECT COUNT(*) FROM threads t WHERE t.board_id = b.id) AS thread_count
         FROM boards b ORDER BY b.id'
    )->fetchAll();

    render('home', ['boards' => $boards], 'Boards');
}

function board_controller(): void
{
    $boardId = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);
    if (!$boardId) {
        abort(404, 'Board not found.');
    }

    $stmt = db()->prepare('SELECT id, name, description FROM boards WHERE id = :id');
    $stmt->execute([':id' => $boardId]);
    $board = $stmt->fetch();
    if (!$board) {
        abort(404, 'Board not found.');
    }

    // Threads newest-first, each with its reply count.
    $stmt = db()->prepare(
        'SELECT t.id, t.title, t.created_at, u.username,
                (SELECT COUNT(*) FROM replies r WHERE r.thread_id = t.id) AS reply_count
         FROM threads t
         JOIN users u ON u.id = t.user_id
         WHERE t.board_id = :board
         ORDER BY t.created_at DESC, t.id DESC'
    );
    $stmt->execute([':board' => $boardId]);
    $threads = $stmt->fetchAll();

    render('board', ['board' => $board, 'threads' => $threads], $board['name']);
}

/* ------------------------------- Threads --------------------------------- */

function thread_controller(): void
{
    $threadId = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);
    if (!$threadId) {
        abort(404, 'Thread not found.');
    }

    $stmt = db()->prepare(
        'SELECT t.id, t.board_id, t.user_id, t.title, t.body, t.created_at,
                u.username, b.name AS board_name
         FROM threads t
         JOIN users u ON u.id = t.user_id
         JOIN boards b ON b.id = t.board_id
         WHERE t.id = :id'
    );
    $stmt->execute([':id' => $threadId]);
    $thread = $stmt->fetch();
    if (!$thread) {
        abort(404, 'Thread not found.');
    }

    $stmt = db()->prepare(
        'SELECT r.id, r.user_id, r.body, r.created_at, u.username
         FROM replies r
         JOIN users u ON u.id = r.user_id
         WHERE r.thread_id = :tid
         ORDER BY r.created_at, r.id'
    );
    $stmt->execute([':tid' => $threadId]);
    $replies = $stmt->fetchAll();

    render('thread', ['thread' => $thread, 'replies' => $replies], $thread['title']);
}

function thread_create_controller(): void
{
    require_post();
    $user = require_login();
    verify_csrf();

    $boardId = filter_input(INPUT_POST, 'board_id', FILTER_VALIDATE_INT);
    $title = str_input('title');
    $body = str_input('body');

    $errors = [];
    if (!$boardId) {
        $errors[] = 'A valid board is required.';
    } else {
        $check = db()->prepare('SELECT 1 FROM boards WHERE id = :id');
        $check->execute([':id' => $boardId]);
        if (!$check->fetchColumn()) {
            $errors[] = 'That board does not exist.';
        }
    }
    $len = mb_strlen($title);
    if ($len < 3 || $len > 200) {
        $errors[] = 'Title must be between 3 and 200 characters.';
    }
    $blen = mb_strlen($body);
    if ($blen < 1 || $blen > 10000) {
        $errors[] = 'Body must be between 1 and 10,000 characters.';
    }

    if ($errors) {
        flash(implode(' ', $errors));
        redirect($boardId ? '/board?id=' . $boardId : '/');
    }

    $stmt = db()->prepare(
        'INSERT INTO threads (board_id, user_id, title, body)
         VALUES (:board, :user, :title, :body)'
    );
    $stmt->execute([
        ':board' => $boardId,
        ':user'  => $user['id'],
        ':title' => $title,
        ':body'  => $body,
    ]);
    redirect('/thread?id=' . db()->lastInsertId());
}

/* ------------------------------- Replies --------------------------------- */

function reply_create_controller(): void
{
    require_post();
    $user = require_login();
    verify_csrf();

    $threadId = filter_input(INPUT_POST, 'thread_id', FILTER_VALIDATE_INT);
    $body = str_input('body');

    if (!$threadId) {
        abort(400, 'Invalid thread.');
    }
    $check = db()->prepare('SELECT 1 FROM threads WHERE id = :id');
    $check->execute([':id' => $threadId]);
    if (!$check->fetchColumn()) {
        abort(404, 'Thread not found.');
    }

    $blen = mb_strlen($body);
    if ($blen < 1 || $blen > 10000) {
        flash('Reply must be between 1 and 10,000 characters.');
        redirect('/thread?id=' . $threadId);
    }

    $stmt = db()->prepare(
        'INSERT INTO replies (thread_id, user_id, body) VALUES (:tid, :uid, :body)'
    );
    $stmt->execute([':tid' => $threadId, ':uid' => $user['id'], ':body' => $body]);
    redirect('/thread?id=' . $threadId . '#reply-' . db()->lastInsertId());
}

/* ------------------------------- Deletion -------------------------------- */

/**
 * Delete a thread or reply. Access control: only the author OR a moderator
 * may delete. This guards against IDOR — ownership is checked server-side
 * against the authenticated user, never trusted from the request.
 */
function post_delete_controller(): void
{
    require_post();
    $user = require_login();
    verify_csrf();

    $type = $_POST['type'] ?? '';
    $id = filter_input(INPUT_POST, 'id', FILTER_VALIDATE_INT);
    if (!$id || !in_array($type, ['thread', 'reply'], true)) {
        abort(400, 'Invalid delete request.');
    }

    if ($type === 'thread') {
        $stmt = db()->prepare('SELECT user_id, board_id FROM threads WHERE id = :id');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        if (!$row) {
            abort(404, 'Thread not found.');
        }
        if ((int) $row['user_id'] !== (int) $user['id'] && !is_moderator()) {
            abort(403, 'You do not have permission to delete this thread.');
        }
        $del = db()->prepare('DELETE FROM threads WHERE id = :id');
        $del->execute([':id' => $id]);
        flash('Thread deleted.');
        redirect('/board?id=' . (int) $row['board_id']);
    }

    // reply
    $stmt = db()->prepare('SELECT user_id, thread_id FROM replies WHERE id = :id');
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();
    if (!$row) {
        abort(404, 'Reply not found.');
    }
    if ((int) $row['user_id'] !== (int) $user['id'] && !is_moderator()) {
        abort(403, 'You do not have permission to delete this reply.');
    }
    $del = db()->prepare('DELETE FROM replies WHERE id = :id');
    $del->execute([':id' => $id]);
    flash('Reply deleted.');
    redirect('/thread?id=' . (int) $row['thread_id']);
}

/* --------------------------- Auth: register ------------------------------ */

function register_form_controller(): void
{
    if (current_user()) {
        redirect('/');
    }
    render('register', ['username' => ''], 'Register');
}

function register_controller(): void
{
    require_post();
    verify_csrf();
    if (current_user()) {
        redirect('/');
    }

    $username = str_input('username');
    $password = (string) ($_POST['password'] ?? '');
    $confirm = (string) ($_POST['password_confirm'] ?? '');

    $errors = [];
    if (!preg_match('/^[A-Za-z0-9_]{3,30}$/', $username)) {
        $errors[] = 'Username must be 3–30 characters: letters, numbers, or underscore.';
    }
    if (strlen($password) < 8 || strlen($password) > 200) {
        $errors[] = 'Password must be between 8 and 200 characters.';
    }
    if ($password !== $confirm) {
        $errors[] = 'Passwords do not match.';
    }

    if (!$errors) {
        $exists = db()->prepare('SELECT 1 FROM users WHERE username = :u');
        $exists->execute([':u' => $username]);
        if ($exists->fetchColumn()) {
            $errors[] = 'That username is already taken.';
        }
    }

    if ($errors) {
        flash(implode(' ', $errors));
        render('register', ['username' => $username], 'Register');
        return;
    }

    // Strong, salted password hashing (bcrypt, cost 12).
    $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
    $stmt = db()->prepare(
        'INSERT INTO users (username, password_hash, role) VALUES (:u, :h, :r)'
    );
    $stmt->execute([':u' => $username, ':h' => $hash, ':r' => 'user']);

    login_user((int) db()->lastInsertId());
    flash('Welcome, ' . $username . '! Your account was created.');
    redirect('/');
}

/* ----------------------------- Auth: login ------------------------------- */

function login_form_controller(): void
{
    if (current_user()) {
        redirect('/');
    }
    render('login', ['username' => ''], 'Log in');
}

function login_controller(): void
{
    require_post();
    verify_csrf();

    $username = str_input('username');
    $password = (string) ($_POST['password'] ?? '');

    $stmt = db()->prepare('SELECT id, password_hash FROM users WHERE username = :u');
    $stmt->execute([':u' => $username]);
    $user = $stmt->fetch();

    // Constant-ish behaviour: always run a real bcrypt verify to limit user
    // enumeration via timing, and use a single generic error message.
    // ($dummy is a valid cost-12 hash of a random value, so verify does real work.)
    $dummy = '$2y$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';
    if ($user) {
        $valid = password_verify($password, $user['password_hash']);
    } else {
        password_verify($password, $dummy);
        $valid = false;
    }

    if (!$valid) {
        flash('Invalid username or password.');
        render('login', ['username' => $username], 'Log in');
        return;
    }

    // Transparently upgrade the hash if the cost/algorithm changed.
    if (password_needs_rehash($user['password_hash'], PASSWORD_BCRYPT, ['cost' => 12])) {
        $newHash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
        $upd = db()->prepare('UPDATE users SET password_hash = :h WHERE id = :id');
        $upd->execute([':h' => $newHash, ':id' => $user['id']]);
    }

    login_user((int) $user['id']);
    redirect('/');
}

function logout_controller(): void
{
    require_post();
    verify_csrf();
    logout_user();
    redirect('/');
}
