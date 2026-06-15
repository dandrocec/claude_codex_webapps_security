<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Auth;
use App\Csrf;
use App\Quote;

/**
 * Admin-only moderation queue. Access is gated by Auth::requireAdmin(),
 * enforcing role-based access control on every action.
 */
final class AdminController
{
    public function index(): void
    {
        $user = Auth::requireAdmin();
        view('admin/index', [
            'title'   => 'Moderation queue',
            'pending' => Quote::pending(),
            'user'    => $user,
        ]);
    }

    public function approve(): void
    {
        Auth::requireAdmin();
        Csrf::check();
        Quote::setApproved($this->idParam(), true);
        flash('success', 'Quote approved and published.');
        redirect('/admin');
    }

    public function reject(): void
    {
        Auth::requireAdmin();
        Csrf::check();
        Quote::delete($this->idParam());
        flash('success', 'Quote rejected and removed.');
        redirect('/admin');
    }

    private function idParam(): int
    {
        // id is supplied via the URL path (injected into $_GET by the router).
        $id = filter_var($_GET['id'] ?? null, FILTER_VALIDATE_INT);
        if ($id === false || $id < 1) {
            http_response_code(404);
            view('errors/404', ['title' => 'Not found']);
            exit;
        }
        return (int) $id;
    }
}
