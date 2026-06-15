<?php

declare(strict_types=1);

use App\Auth;
use App\Listing;
use App\Upload;

/*
 * Front controller. Every request is routed through this file. When running
 * under the PHP built-in server, existing static files (CSS, uploaded photos)
 * are served directly.
 */

$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '/';

if (PHP_SAPI === 'cli-server') {
    $file = __DIR__ . urldecode($uri);
    if ($uri !== '/' && is_file($file)) {
        return false;
    }
}

require dirname(__DIR__) . '/src/Database.php';
require dirname(__DIR__) . '/src/helpers.php';
require dirname(__DIR__) . '/src/Auth.php';
require dirname(__DIR__) . '/src/Listing.php';
require dirname(__DIR__) . '/src/Upload.php';

session_start();

$path = rtrim($uri, '/');
if ($path === '') {
    $path = '/';
}
$method = $_SERVER['REQUEST_METHOD'];
$route = $method . ' ' . $path;

try {
    switch ($route) {
        case 'GET /':            home(); break;
        case 'GET /listing':     show(); break;

        case 'GET /register':    registerForm(); break;
        case 'POST /register':   registerSubmit(); break;
        case 'GET /login':       loginForm(); break;
        case 'POST /login':      loginSubmit(); break;
        case 'POST /logout':     logout(); break;

        case 'GET /my':          myListings(); break;
        case 'GET /sell':        createForm(); break;
        case 'POST /sell':       createSubmit(); break;
        case 'GET /edit':        editForm(); break;
        case 'POST /edit':       editSubmit(); break;
        case 'POST /delete':     deleteSubmit(); break;

        default:
            http_response_code(404);
            render('404', [], 'Not Found');
    }
} catch (Throwable $e) {
    http_response_code(500);
    echo 'Server error: ' . e($e->getMessage());
}

/* ----------------------------------------------------------------------------
 * Public browsing
 * ------------------------------------------------------------------------- */

function home(): void
{
    $keyword = trim((string) ($_GET['q'] ?? ''));
    $categoryId = isset($_GET['category']) && $_GET['category'] !== ''
        ? (int) $_GET['category']
        : null;
    $page = max(1, (int) ($_GET['page'] ?? 1));

    $result = Listing::search($keyword ?: null, $categoryId, $page);

    render('home', [
        'listings' => $result['items'],
        'total' => $result['total'],
        'page' => $page,
        'perPage' => Listing::PER_PAGE,
        'keyword' => $keyword,
        'categoryId' => $categoryId,
        'categories' => Listing::categories(),
    ]);
}

function show(): void
{
    $listing = Listing::find((int) ($_GET['id'] ?? 0));
    if (!$listing) {
        http_response_code(404);
        render('404', [], 'Not Found');
        return;
    }

    render('listing', ['listing' => $listing], $listing['title']);
}

/* ----------------------------------------------------------------------------
 * Authentication
 * ------------------------------------------------------------------------- */

function registerForm(): void
{
    if (Auth::check()) {
        redirect('/');
    }
    render('register', ['old' => []], 'Register');
}

function registerSubmit(): void
{
    csrf_verify();

    $username = (string) ($_POST['username'] ?? '');
    $email = (string) ($_POST['email'] ?? '');
    $password = (string) ($_POST['password'] ?? '');

    $errors = Auth::register($username, $email, $password);
    if ($errors) {
        render('register', [
            'errors' => $errors,
            'old' => ['username' => $username, 'email' => $email],
        ], 'Register');
        return;
    }

    flash('Welcome, ' . $username . '! Your account is ready.');
    redirect('/');
}

function loginForm(): void
{
    if (Auth::check()) {
        redirect('/');
    }
    render('login', ['old' => []], 'Log in');
}

function loginSubmit(): void
{
    csrf_verify();

    $email = (string) ($_POST['email'] ?? '');
    $password = (string) ($_POST['password'] ?? '');

    if (!Auth::login($email, $password)) {
        render('login', [
            'errors' => ['Incorrect email or password.'],
            'old' => ['email' => $email],
        ], 'Log in');
        return;
    }

    flash('Logged in successfully.');
    redirect('/');
}

function logout(): void
{
    csrf_verify();
    Auth::logout();
    flash('You have been logged out.');
    redirect('/');
}

/* ----------------------------------------------------------------------------
 * Seller dashboard & listing management
 * ------------------------------------------------------------------------- */

function myListings(): void
{
    Auth::requireLogin();
    $user = Auth::user();

    render('my-listings', [
        'listings' => Listing::forUser((int) $user['id']),
    ], 'My listings');
}

function createForm(): void
{
    Auth::requireLogin();
    render('listing-form', [
        'listing' => null,
        'categories' => Listing::categories(),
        'old' => [],
        'action' => '/sell',
    ], 'Post an item');
}

function createSubmit(): void
{
    Auth::requireLogin();
    csrf_verify();

    $user = Auth::user();
    [$data, $errors] = validateListing();

    if ($errors) {
        Upload::delete($data['photo']); // discard any just-uploaded file
        render('listing-form', [
            'listing' => null,
            'categories' => Listing::categories(),
            'old' => $_POST,
            'errors' => $errors,
            'action' => '/sell',
        ], 'Post an item');
        return;
    }

    $id = Listing::create((int) $user['id'], $data);
    flash('Your listing has been posted.');
    redirect('/listing?id=' . $id);
}

function editForm(): void
{
    Auth::requireLogin();
    $listing = ownedListingOr404((int) ($_GET['id'] ?? 0));

    render('listing-form', [
        'listing' => $listing,
        'categories' => Listing::categories(),
        'old' => $listing,
        'action' => '/edit?id=' . $listing['id'],
    ], 'Edit listing');
}

function editSubmit(): void
{
    Auth::requireLogin();
    csrf_verify();

    $listing = ownedListingOr404((int) ($_GET['id'] ?? 0));
    [$data, $errors] = validateListing();

    if ($errors) {
        Upload::delete($data['photo']); // discard any just-uploaded file
        render('listing-form', [
            'listing' => $listing,
            'categories' => Listing::categories(),
            'old' => $_POST + ['id' => $listing['id']],
            'errors' => $errors,
            'action' => '/edit?id=' . $listing['id'],
        ], 'Edit listing');
        return;
    }

    // Keep the existing photo unless a new one was uploaded.
    if ($data['photo'] === null) {
        $data['photo'] = $listing['photo'];
    } elseif ($listing['photo']) {
        Upload::delete($listing['photo']);
    }

    Listing::update((int) $listing['id'], $data);
    flash('Your listing has been updated.');
    redirect('/listing?id=' . $listing['id']);
}

function deleteSubmit(): void
{
    Auth::requireLogin();
    csrf_verify();

    $listing = ownedListingOr404((int) ($_POST['id'] ?? 0));
    Upload::delete($listing['photo']);
    Listing::delete((int) $listing['id']);

    flash('Your listing has been removed.');
    redirect('/my');
}

/* ----------------------------------------------------------------------------
 * Helpers shared by the controllers above
 * ------------------------------------------------------------------------- */

/**
 * Fetch a listing and guarantee it belongs to the current user, or render 404.
 */
function ownedListingOr404(int $id): array
{
    $listing = Listing::find($id);
    $user = Auth::user();

    if (!$listing || (int) $listing['user_id'] !== (int) $user['id']) {
        http_response_code(404);
        render('404', [], 'Not Found');
        exit;
    }

    return $listing;
}

/**
 * Validate the listing form and process the photo upload.
 *
 * @return array{0: array, 1: array<int, string>} [data, errors]
 */
function validateListing(): array
{
    $errors = [];

    $title = trim((string) ($_POST['title'] ?? ''));
    $priceRaw = trim((string) ($_POST['price'] ?? ''));
    $description = trim((string) ($_POST['description'] ?? ''));
    $categoryId = (int) ($_POST['category_id'] ?? 0);

    if ($title === '') {
        $errors[] = 'A title is required.';
    } elseif (mb_strlen($title) > 120) {
        $errors[] = 'The title must be 120 characters or fewer.';
    }

    if ($priceRaw === '' || !is_numeric($priceRaw) || (float) $priceRaw < 0) {
        $errors[] = 'Please enter a valid, non-negative price.';
    }

    if (!Listing::category($categoryId)) {
        $errors[] = 'Please choose a category.';
    }

    $photo = Upload::store($_FILES['photo'] ?? null, $errors);

    $data = [
        'title' => $title,
        'price' => (float) $priceRaw,
        'description' => $description,
        'category_id' => $categoryId,
        'photo' => $photo,
    ];

    return [$data, $errors];
}
