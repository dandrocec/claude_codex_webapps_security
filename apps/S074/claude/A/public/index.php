<?php

declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

/*
 * Tiny front-controller router. Each route maps "METHOD path" to a handler.
 * The PHP built-in server serves /public, so all dynamic requests land here.
 */

$method = $_SERVER['REQUEST_METHOD'];
$path   = rtrim(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/', '/');
if ($path === '') {
    $path = '/';
}

$routes = [
    'GET /'                          => 'home_page',
    'GET /product'                   => 'product_page',

    'GET /cart'                      => 'cart_view',
    'POST /cart/add'                 => 'cart_add',
    'POST /cart/update'              => 'cart_update',
    'POST /cart/remove'              => 'cart_remove',
    'POST /checkout'                 => 'checkout',

    'GET /orders'                    => 'buyer_orders',

    'GET /vendor/products'           => 'vendor_products',
    'GET /vendor/products/new'       => 'vendor_product_new',
    'POST /vendor/products/create'   => 'vendor_product_create',
    'GET /vendor/products/edit'      => 'vendor_product_edit',
    'POST /vendor/products/update'   => 'vendor_product_update',
    'POST /vendor/products/delete'   => 'vendor_product_delete',
    'GET /vendor/orders'             => 'vendor_orders',

    'GET /login'                     => 'show_login',
    'POST /login'                    => 'do_login',
    'GET /register'                  => 'show_register',
    'POST /register'                 => 'do_register',
    'POST /logout'                   => 'do_logout',
];

$handler = $routes[$method . ' ' . $path] ?? null;

if ($handler === null) {
    http_response_code(404);
    render('error', ['title' => 'Page not found',
        'message' => 'The page you requested could not be found.']);
    exit;
}

$handler();
