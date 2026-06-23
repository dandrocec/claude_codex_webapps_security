<?php

declare(strict_types=1);

/**
 * Front controller — the single public entry point. The web server document
 * root is this `public/` directory, so application source, the database and the
 * .env file all live OUTSIDE the web root and cannot be requested directly.
 */

use App\Controllers\AuthController;
use App\Controllers\CartController;
use App\Controllers\OrderController;
use App\Controllers\ProductController;
use App\Controllers\VendorController;
use App\Http;
use App\HttpException;
use App\Router;
use App\Session;

use function App\render_error_page;
use function App\send_security_headers;

require dirname(__DIR__) . '/src/bootstrap.php';

send_security_headers();

$router = new Router();

// Public catalogue
$router->get('/', [new ProductController(), 'index']);
$router->get('/product', [new ProductController(), 'show']);

// Authentication
$auth = new AuthController();
$router->get('/register', [$auth, 'showRegister']);
$router->post('/register', [$auth, 'register']);
$router->get('/login', [$auth, 'showLogin']);
$router->post('/login', [$auth, 'login']);
$router->post('/logout', [$auth, 'logout']);

// Cart (browsing the cart is open; checkout requires a buyer login)
$cart = new CartController();
$router->get('/cart', [$cart, 'show']);
$router->post('/cart/add', [$cart, 'add']);
$router->post('/cart/update', [$cart, 'update']);
$router->post('/cart/remove', [$cart, 'remove']);

// Buyer orders
$orders = new OrderController();
$router->post('/checkout', [$orders, 'checkout']);
$router->get('/orders', [$orders, 'index']);

// Vendor area
$vendor = new VendorController();
$router->get('/vendor/products', [$vendor, 'products']);
$router->get('/vendor/products/new', [$vendor, 'createForm']);
$router->post('/vendor/products', [$vendor, 'store']);
$router->get('/vendor/products/edit', [$vendor, 'editForm']);
$router->post('/vendor/products/update', [$vendor, 'update']);
$router->post('/vendor/products/delete', [$vendor, 'delete']);
$router->get('/vendor/orders', [$vendor, 'orders']);

try {
    echo $router->dispatch();
} catch (HttpException $e) {
    // Special signal used by access-control gates to bounce to the login page.
    if (str_starts_with($e->getMessage(), 'redirect:')) {
        echo Http::redirect(substr($e->getMessage(), strlen('redirect:')));
    } else {
        render_error_page($e->status, $e->getMessage());
    }
}
