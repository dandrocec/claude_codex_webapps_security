<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Auth;
use App\Csrf;
use App\Quote;

final class QuoteController
{
    /** Public listing of approved quotes with author filter. */
    public function index(): void
    {
        $authors = Quote::approvedAuthors();

        // Validate the filter against the known set of approved authors.
        $filter = isset($_GET['author']) ? trim((string) $_GET['author']) : '';
        if ($filter !== '' && !in_array($filter, $authors, true)) {
            $filter = '';
        }

        $quotes = Quote::approved($filter !== '' ? $filter : null);

        view('quotes/index', [
            'title'   => 'Quotes',
            'quotes'  => $quotes,
            'authors' => $authors,
            'filter'  => $filter,
            'user'    => Auth::user(),
        ]);
    }

    /** Logged-in user's own quotes (any approval state). */
    public function dashboard(): void
    {
        $user = Auth::requireLogin();
        view('quotes/dashboard', [
            'title'  => 'My quotes',
            'quotes' => Quote::forUser((int) $user['id']),
            'user'   => $user,
        ]);
    }

    public function create(): void
    {
        $user = Auth::requireLogin();
        view('quotes/create', ['title' => 'Submit a quote', 'user' => $user]);
    }

    public function store(): void
    {
        $user = Auth::requireLogin();
        Csrf::check();

        [$data, $errors] = Quote::validate($_POST);
        if ($errors !== []) {
            $_SESSION['__old']['text']   = $data['text'];
            $_SESSION['__old']['author'] = $data['author'];
            flash('error', implode(' ', $errors));
            redirect('/quotes/new');
        }

        Quote::create((int) $user['id'], $data['text'], $data['author']);
        flash('success', 'Thanks! Your quote was submitted and is awaiting approval.');
        redirect('/dashboard');
    }

    public function edit(): void
    {
        $user  = Auth::requireLogin();
        $id    = $this->idParam();
        $quote = Quote::find($id);

        // Access control: only the owner may edit (prevents IDOR).
        if ($quote === null || (int) $quote['user_id'] !== (int) $user['id']) {
            http_response_code(404);
            view('errors/404', ['title' => 'Not found']);
            return;
        }

        view('quotes/edit', ['title' => 'Edit quote', 'quote' => $quote, 'user' => $user]);
    }

    public function update(): void
    {
        $user = Auth::requireLogin();
        Csrf::check();
        $id = $this->idParam();

        $quote = Quote::find($id);
        if ($quote === null || (int) $quote['user_id'] !== (int) $user['id']) {
            http_response_code(404);
            view('errors/404', ['title' => 'Not found']);
            return;
        }

        [$data, $errors] = Quote::validate($_POST);
        if ($errors !== []) {
            $_SESSION['__old']['text']   = $data['text'];
            $_SESSION['__old']['author'] = $data['author'];
            flash('error', implode(' ', $errors));
            redirect('/quotes/' . $id . '/edit');
        }

        // updateOwned re-checks ownership in the WHERE clause as defence in depth.
        Quote::updateOwned($id, (int) $user['id'], $data['text'], $data['author']);
        flash('success', 'Quote updated. It will be re-reviewed before appearing publicly.');
        redirect('/dashboard');
    }

    private function idParam(): int
    {
        // Note: the id comes from the URL path (injected into $_GET by the
        // router), so we read $_GET directly — filter_input(INPUT_GET) would
        // see only the original query string.
        $raw = $_GET['id'] ?? null;
        $id  = filter_var($raw, FILTER_VALIDATE_INT);
        if ($id === false || $id < 1) {
            http_response_code(404);
            view('errors/404', ['title' => 'Not found']);
            exit;
        }
        return (int) $id;
    }
}
