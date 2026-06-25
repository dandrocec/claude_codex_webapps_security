<?php

declare(strict_types=1);

function showPublicQuotes(): void
{
    $author = trim($_GET['author'] ?? '');
    $params = [];
    $where = 'WHERE q.approved = 1';

    if ($author !== '') {
        $where .= ' AND q.author = :author';
        $params['author'] = $author;
    }

    $stmt = db()->prepare(
        "SELECT q.*, u.name AS submitter
         FROM quotes q
         JOIN users u ON u.id = q.user_id
         $where
         ORDER BY q.created_at DESC"
    );
    $stmt->execute($params);

    $authors = db()
        ->query('SELECT DISTINCT author FROM quotes WHERE approved = 1 ORDER BY author COLLATE NOCASE')
        ->fetchAll();

    render('quotes/index', [
        'title' => APP_NAME,
        'quotes' => $stmt->fetchAll(),
        'authors' => $authors,
        'selectedAuthor' => $author,
    ]);
}

function showDashboard(): void
{
    $user = currentUser();

    if ((bool) $user['is_admin']) {
        $quotes = db()
            ->query(
                'SELECT q.*, u.name AS submitter
                 FROM quotes q
                 JOIN users u ON u.id = q.user_id
                 ORDER BY q.approved ASC, q.created_at DESC'
            )
            ->fetchAll();
    } else {
        $stmt = db()->prepare('SELECT * FROM quotes WHERE user_id = :user_id ORDER BY created_at DESC');
        $stmt->execute(['user_id' => $user['id']]);
        $quotes = $stmt->fetchAll();
    }

    render('dashboard', ['title' => 'Dashboard', 'quotes' => $quotes]);
}

function showRegister(): void
{
    render('auth/register', ['title' => 'Register']);
}

function showLogin(): void
{
    render('auth/login', ['title' => 'Login']);
}

function showQuoteForm(?int $id = null): void
{
    $quote = null;

    if ($id !== null) {
        $quote = findEditableQuote($id);
    }

    render('quotes/form', [
        'title' => $quote ? 'Edit Quote' : 'Submit Quote',
        'quote' => $quote,
    ]);
}

function handleCreateQuote(): void
{
    $text = trim($_POST['quote_text'] ?? '');
    $author = trim($_POST['author'] ?? '');

    if ($text === '' || $author === '') {
        rememberOld(['quote_text' => $text, 'author' => $author]);
        flash('Quote text and author are required.', 'error');
        redirect('/quotes/new');
    }

    $stmt = db()->prepare(
        'INSERT INTO quotes (user_id, quote_text, author, approved) VALUES (:user_id, :quote_text, :author, :approved)'
    );
    $stmt->execute([
        'user_id' => currentUser()['id'],
        'quote_text' => $text,
        'author' => $author,
        'approved' => currentUser()['is_admin'] ? 1 : 0,
    ]);

    clearOld();
    flash(currentUser()['is_admin'] ? 'Quote published.' : 'Quote submitted for approval.');
    redirect('/dashboard');
}

function handleUpdateQuote(int $id): void
{
    $quote = findEditableQuote($id);
    $text = trim($_POST['quote_text'] ?? '');
    $author = trim($_POST['author'] ?? '');

    if ($text === '' || $author === '') {
        rememberOld(['quote_text' => $text, 'author' => $author]);
        flash('Quote text and author are required.', 'error');
        redirect('/quotes/' . $id . '/edit');
    }

    $approved = currentUser()['is_admin'] ? (int) isset($_POST['approved']) : 0;

    $stmt = db()->prepare(
        'UPDATE quotes
         SET quote_text = :quote_text, author = :author, approved = :approved, updated_at = CURRENT_TIMESTAMP
         WHERE id = :id'
    );
    $stmt->execute([
        'quote_text' => $text,
        'author' => $author,
        'approved' => $approved,
        'id' => $quote['id'],
    ]);

    clearOld();
    flash(currentUser()['is_admin'] ? 'Quote updated.' : 'Quote updated and returned to approval.');
    redirect('/dashboard');
}

function handleApproveQuote(int $id): void
{
    $quote = findQuote($id);
    $approved = $quote['approved'] ? 0 : 1;

    $stmt = db()->prepare('UPDATE quotes SET approved = :approved, updated_at = CURRENT_TIMESTAMP WHERE id = :id');
    $stmt->execute(['approved' => $approved, 'id' => $id]);

    flash($approved ? 'Quote approved.' : 'Quote unpublished.');
    redirect('/dashboard');
}

function handleDeleteQuote(int $id): void
{
    findQuote($id);

    $stmt = db()->prepare('DELETE FROM quotes WHERE id = :id');
    $stmt->execute(['id' => $id]);

    flash('Quote deleted.');
    redirect('/dashboard');
}

function findQuote(int $id): array
{
    $stmt = db()->prepare('SELECT * FROM quotes WHERE id = :id');
    $stmt->execute(['id' => $id]);
    $quote = $stmt->fetch();

    if (!$quote) {
        http_response_code(404);
        render('404', ['title' => 'Quote not found']);
        exit;
    }

    return $quote;
}

function findEditableQuote(int $id): array
{
    $quote = findQuote($id);
    $user = currentUser();

    if (!(bool) $user['is_admin'] && (int) $quote['user_id'] !== (int) $user['id']) {
        http_response_code(403);
        render('403', ['title' => 'Forbidden']);
        exit;
    }

    return $quote;
}

