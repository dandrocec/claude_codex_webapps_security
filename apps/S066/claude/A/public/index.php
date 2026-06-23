<?php

declare(strict_types=1);

use App\Auth;
use App\Helpers;
use App\Listings;
use App\Uploads;

/*
 * Front controller. The PHP built-in server routes every request here
 * (see the router fallback at the bottom for static files).
 */

session_start();

// --- Autoloader: use Composer's if present, otherwise a minimal PSR-4 loader. ---
$composer = dirname(__DIR__) . '/vendor/autoload.php';
if (file_exists($composer)) {
    require $composer;
} else {
    spl_autoload_register(static function (string $class): void {
        $prefix = 'App\\';
        if (str_starts_with($class, $prefix)) {
            $relative = substr($class, strlen($prefix));
            $file = dirname(__DIR__) . '/src/' . str_replace('\\', '/', $relative) . '.php';
            if (file_exists($file)) {
                require $file;
            }
        }
    });
}

// --- Tiny router ---------------------------------------------------------
$method = $_SERVER['REQUEST_METHOD'];
$path = rtrim(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/') ?: '/';

/** Read an int from a request array, or null when blank. */
$intOrNull = static function (array $src, string $key): ?int {
    $v = $src[$key] ?? '';
    return ($v === '' || $v === null) ? null : (int) $v;
};

try {
    switch (true) {

        // ---- Home / browse ------------------------------------------------
        case $method === 'GET' && $path === '/':
        case $method === 'GET' && $path === '/search':
            $filters = [
                'q'         => trim($_GET['q'] ?? ''),
                'location'  => trim($_GET['location'] ?? ''),
                'min_price' => $intOrNull($_GET, 'min_price'),
                'max_price' => $intOrNull($_GET, 'max_price'),
                'type'      => trim($_GET['type'] ?? ''),
            ];
            $hasFilters = $filters['q'] !== '' || $filters['location'] !== ''
                || $filters['min_price'] !== null || $filters['max_price'] !== null
                || $filters['type'] !== '';

            Helpers::view('home', [
                'title'      => 'Find your next property',
                'listings'   => Listings::search($filters),
                'filters'    => $filters,
                'hasFilters' => $hasFilters,
            ]);
            break;

        // ---- Single listing + contact form -------------------------------
        case $method === 'GET' && $path === '/listing':
            $listing = Listings::find((int) ($_GET['id'] ?? 0));
            if (!$listing) {
                http_response_code(404);
                Helpers::view('not_found', ['title' => 'Not found']);
                break;
            }
            Helpers::view('listing', [
                'title'   => $listing['title'],
                'listing' => $listing,
                'photos'  => Listings::photos((int) $listing['id']),
            ]);
            break;

        // ---- Contact agent ------------------------------------------------
        case $method === 'POST' && $path === '/contact':
            $listing = Listings::find((int) ($_POST['listing_id'] ?? 0));
            if (!$listing) {
                http_response_code(404);
                Helpers::view('not_found', ['title' => 'Not found']);
                break;
            }
            $name = trim($_POST['sender_name'] ?? '');
            $email = trim($_POST['sender_email'] ?? '');
            $body = trim($_POST['body'] ?? '');
            if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || $body === '') {
                Helpers::flash('Please provide your name, a valid email, and a message.');
            } else {
                Listings::addMessage((int) $listing['id'], (int) $listing['agent_id'], [
                    'sender_name'  => $name,
                    'sender_email' => $email,
                    'sender_phone' => trim($_POST['sender_phone'] ?? ''),
                    'body'         => $body,
                ]);
                Helpers::flash('Your message was sent to the agent. They will be in touch.');
            }
            Helpers::redirect('/listing?id=' . (int) $listing['id']);
            break;

        // ---- Auth: register ----------------------------------------------
        case $method === 'GET' && $path === '/register':
            Helpers::view('auth/register', ['title' => 'Become an agent']);
            break;

        case $method === 'POST' && $path === '/register':
            $name = trim($_POST['name'] ?? '');
            $email = trim($_POST['email'] ?? '');
            $password = $_POST['password'] ?? '';
            if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($password) < 6) {
                Helpers::flash('Name, a valid email, and a 6+ character password are required.');
                Helpers::redirect('/register');
            }
            $id = Auth::register($name, $email, trim($_POST['phone'] ?? ''), $password);
            if ($id === null) {
                Helpers::flash('That email is already registered.');
                Helpers::redirect('/register');
            }
            Auth::attempt($email, $password);
            Helpers::flash('Welcome! Add your first listing.');
            Helpers::redirect('/dashboard');
            break;

        // ---- Auth: login / logout ----------------------------------------
        case $method === 'GET' && $path === '/login':
            Helpers::view('auth/login', ['title' => 'Agent login']);
            break;

        case $method === 'POST' && $path === '/login':
            if (Auth::attempt(trim($_POST['email'] ?? ''), $_POST['password'] ?? '')) {
                Helpers::redirect('/dashboard');
            }
            Helpers::flash('Invalid email or password.');
            Helpers::redirect('/login');
            break;

        case $method === 'POST' && $path === '/logout':
            Auth::logout();
            Helpers::redirect('/');
            break;

        // ---- Agent dashboard ---------------------------------------------
        case $method === 'GET' && $path === '/dashboard':
            Auth::requireLogin();
            Helpers::view('agent/dashboard', [
                'title'    => 'My listings',
                'listings' => Listings::forAgent(Auth::id()),
                'messages' => Listings::messagesForAgent(Auth::id()),
            ]);
            break;

        // ---- Create listing ----------------------------------------------
        case $method === 'GET' && $path === '/listings/new':
            Auth::requireLogin();
            Helpers::view('agent/form', [
                'title'   => 'New listing',
                'listing' => null,
            ]);
            break;

        case $method === 'POST' && $path === '/listings':
            Auth::requireLogin();
            $data = collect_listing_input($_POST);
            $error = validate_listing($data);
            if ($error) {
                Helpers::flash($error);
                Helpers::redirect('/listings/new');
            }
            $id = Listings::create(Auth::id(), $data);
            foreach (Uploads::storeMany($_FILES['photos'] ?? []) as $file) {
                Listings::addPhoto($id, $file);
            }
            Helpers::flash('Listing published.');
            Helpers::redirect('/listing?id=' . $id);
            break;

        // ---- Edit listing -------------------------------------------------
        case $method === 'GET' && $path === '/listings/edit':
            Auth::requireLogin();
            $listing = Listings::find((int) ($_GET['id'] ?? 0));
            if (!$listing || (int) $listing['agent_id'] !== Auth::id()) {
                http_response_code(403);
                Helpers::view('not_found', ['title' => 'Not allowed']);
                break;
            }
            Helpers::view('agent/form', [
                'title'   => 'Edit listing',
                'listing' => $listing,
                'photos'  => Listings::photos((int) $listing['id']),
            ]);
            break;

        case $method === 'POST' && $path === '/listings/update':
            Auth::requireLogin();
            $id = (int) ($_POST['id'] ?? 0);
            $listing = Listings::find($id);
            if (!$listing || (int) $listing['agent_id'] !== Auth::id()) {
                http_response_code(403);
                Helpers::view('not_found', ['title' => 'Not allowed']);
                break;
            }
            $data = collect_listing_input($_POST);
            $error = validate_listing($data);
            if ($error) {
                Helpers::flash($error);
                Helpers::redirect('/listings/edit?id=' . $id);
            }
            Listings::update($id, Auth::id(), $data);
            foreach (Uploads::storeMany($_FILES['photos'] ?? []) as $file) {
                Listings::addPhoto($id, $file);
            }
            Helpers::flash('Listing updated.');
            Helpers::redirect('/listing?id=' . $id);
            break;

        // ---- Delete listing ----------------------------------------------
        case $method === 'POST' && $path === '/listings/delete':
            Auth::requireLogin();
            Listings::delete((int) ($_POST['id'] ?? 0), Auth::id());
            Helpers::flash('Listing deleted.');
            Helpers::redirect('/dashboard');
            break;

        // ---- 404 ----------------------------------------------------------
        default:
            http_response_code(404);
            Helpers::view('not_found', ['title' => 'Not found']);
    }
} catch (\Throwable $e) {
    http_response_code(500);
    echo '<h1>Something went wrong</h1>';
    echo '<pre>' . Helpers::e($e->getMessage()) . '</pre>';
}

// --- Input helpers -------------------------------------------------------

function collect_listing_input(array $src): array
{
    return [
        'title'         => trim($src['title'] ?? ''),
        'description'   => trim($src['description'] ?? ''),
        'price'         => max(0, (int) ($src['price'] ?? 0)),
        'location'      => trim($src['location'] ?? ''),
        'address'       => trim($src['address'] ?? ''),
        'bedrooms'      => max(0, (int) ($src['bedrooms'] ?? 0)),
        'bathrooms'     => max(0, (int) ($src['bathrooms'] ?? 0)),
        'area_sqft'     => max(0, (int) ($src['area_sqft'] ?? 0)),
        'property_type' => trim($src['property_type'] ?? 'House'),
    ];
}

function validate_listing(array $data): ?string
{
    if ($data['title'] === '') {
        return 'A title is required.';
    }
    if ($data['location'] === '') {
        return 'A location is required.';
    }
    if ($data['price'] <= 0) {
        return 'Please enter a price greater than zero.';
    }
    return null;
}
