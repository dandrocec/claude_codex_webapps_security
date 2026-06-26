<?php

declare(strict_types=1);

namespace Marketplace;

final class App
{
    public function __construct(
        private readonly Repository $repository,
        private readonly Auth $auth,
        private readonly Csrf $csrf,
        private readonly Cart $cart,
        private readonly View $view,
    ) {
    }

    public function dispatch(): void
    {
        $path = Http::path();
        $method = Http::method();

        if ($method === 'GET' && $path === '/') {
            $this->view->render('home', ['products' => $this->repository->listActiveProducts()]);
            return;
        }
        if ($method === 'GET' && $path === '/register') {
            $this->view->render('register');
            return;
        }
        if ($method === 'POST' && $path === '/register') {
            $this->register();
            return;
        }
        if ($method === 'GET' && $path === '/login') {
            $this->view->render('login');
            return;
        }
        if ($method === 'POST' && $path === '/login') {
            $this->login();
            return;
        }
        if ($method === 'POST' && $path === '/logout') {
            Http::requirePost($this->csrf);
            $this->auth->logout();
            Http::redirect('/');
        }
        if ($method === 'GET' && $path === '/vendor') {
            $vendor = $this->auth->requireRole('vendor');
            $this->view->render('vendor_dashboard', [
                'products' => $this->repository->listVendorProducts((int) $vendor['id']),
                'orders' => $this->repository->vendorOrderItems((int) $vendor['id']),
            ]);
            return;
        }
        if ($method === 'POST' && $path === '/vendor/products') {
            $this->createProduct();
            return;
        }
        if ($method === 'GET' && preg_match('#^/vendor/products/(\d+)/edit$#', $path, $matches)) {
            $this->editProduct((int) $matches[1]);
            return;
        }
        if ($method === 'POST' && preg_match('#^/vendor/products/(\d+)$#', $path, $matches)) {
            $this->updateProduct((int) $matches[1]);
            return;
        }
        if ($method === 'POST' && $path === '/cart/add') {
            $this->addToCart();
            return;
        }
        if ($method === 'GET' && $path === '/cart') {
            $this->showCart();
            return;
        }
        if ($method === 'POST' && $path === '/cart/update') {
            $this->updateCart();
            return;
        }
        if ($method === 'POST' && $path === '/checkout') {
            $this->checkout();
            return;
        }
        if ($method === 'GET' && $path === '/orders') {
            $buyer = $this->auth->requireRole('buyer');
            $this->view->render('orders', ['orders' => $this->repository->buyerOrders((int) $buyer['id'])]);
            return;
        }
        if ($method === 'GET' && preg_match('#^/orders/(\d+)$#', $path, $matches)) {
            $this->showOrder((int) $matches[1]);
            return;
        }

        http_response_code(404);
        $this->view->render('not_found');
    }

    private function register(): void
    {
        Http::requirePost($this->csrf);
        $name = Validator::text($_POST['name'] ?? null, 2, 80);
        $email = Validator::email($_POST['email'] ?? null);
        $password = Validator::password($_POST['password'] ?? null);
        $role = Validator::role($_POST['role'] ?? null);

        if (!$name || !$email || !$password || !$role) {
            $this->view->render('register', ['error' => 'Enter a valid name, email, role, and password of at least 10 characters.']);
            return;
        }

        try {
            $this->repository->createUser($name, $email, $password, $role);
        } catch (\Throwable) {
            $this->view->render('register', ['error' => 'Registration failed. The email may already be in use.']);
            return;
        }

        $this->auth->login($email, $password);
        Http::redirect($role === 'vendor' ? '/vendor' : '/');
    }

    private function login(): void
    {
        Http::requirePost($this->csrf);
        $email = Validator::email($_POST['email'] ?? null);
        $password = Validator::password($_POST['password'] ?? null);
        if (!$email || !$password || !$this->auth->login($email, $password)) {
            $this->view->render('login', ['error' => 'Invalid email or password.']);
            return;
        }

        $user = $this->auth->requireLogin();
        Http::redirect($user['role'] === 'vendor' ? '/vendor' : '/');
    }

    private function createProduct(): void
    {
        Http::requirePost($this->csrf);
        $vendor = $this->auth->requireRole('vendor');
        $name = Validator::text($_POST['name'] ?? null, 2, 120);
        $description = Validator::text($_POST['description'] ?? null, 1, 1000);
        $price = Validator::priceToCents($_POST['price'] ?? null);
        $stock = Validator::intRange($_POST['stock'] ?? null, 0, 100000);

        if (!$name || !$description || $price === null || $stock === null) {
            $this->view->render('vendor_dashboard', [
                'error' => 'Product details are invalid.',
                'products' => $this->repository->listVendorProducts((int) $vendor['id']),
                'orders' => $this->repository->vendorOrderItems((int) $vendor['id']),
            ]);
            return;
        }

        $this->repository->createProduct((int) $vendor['id'], $name, $description, $price, $stock);
        Http::redirect('/vendor');
    }

    private function editProduct(int $productId): void
    {
        $vendor = $this->auth->requireRole('vendor');
        $product = $this->repository->getOwnProduct((int) $vendor['id'], $productId);
        if (!$product) {
            http_response_code(404);
            $this->view->render('not_found');
            return;
        }
        $this->view->render('product_edit', ['product' => $product]);
    }

    private function updateProduct(int $productId): void
    {
        Http::requirePost($this->csrf);
        $vendor = $this->auth->requireRole('vendor');
        $name = Validator::text($_POST['name'] ?? null, 2, 120);
        $description = Validator::text($_POST['description'] ?? null, 1, 1000);
        $price = Validator::priceToCents($_POST['price'] ?? null);
        $stock = Validator::intRange($_POST['stock'] ?? null, 0, 100000);
        $active = isset($_POST['is_active']);

        if (!$name || !$description || $price === null || $stock === null) {
            $product = $this->repository->getOwnProduct((int) $vendor['id'], $productId);
            $this->view->render('product_edit', ['product' => $product, 'error' => 'Product details are invalid.']);
            return;
        }

        if (!$this->repository->updateOwnProduct((int) $vendor['id'], $productId, $name, $description, $price, $stock, $active)) {
            http_response_code(404);
            $this->view->render('not_found');
            return;
        }
        Http::redirect('/vendor');
    }

    private function addToCart(): void
    {
        Http::requirePost($this->csrf);
        $productId = Validator::intRange($_POST['product_id'] ?? null, 1, PHP_INT_MAX);
        $quantity = Validator::intRange($_POST['quantity'] ?? null, 1, 99);
        if ($productId && $quantity && $this->repository->getActiveProduct($productId)) {
            $this->cart->add($productId, $quantity);
        }
        Http::redirect('/cart');
    }

    private function showCart(): void
    {
        $products = $this->repository->productsForCart($this->cart->items());
        $this->view->render('cart', ['products' => $products]);
    }

    private function updateCart(): void
    {
        Http::requirePost($this->csrf);
        foreach ($_POST['quantities'] ?? [] as $productId => $quantity) {
            $id = Validator::intRange($productId, 1, PHP_INT_MAX);
            $qty = Validator::intRange($quantity, 0, 99);
            if ($id !== null && $qty !== null) {
                $this->cart->update($id, $qty);
            }
        }
        Http::redirect('/cart');
    }

    private function checkout(): void
    {
        Http::requirePost($this->csrf);
        $buyer = $this->auth->requireRole('buyer');
        try {
            $orderId = $this->repository->createOrder((int) $buyer['id'], $this->cart->items());
            $this->cart->clear();
            Http::redirect('/orders/' . $orderId);
        } catch (\Throwable) {
            $products = $this->repository->productsForCart($this->cart->items());
            $this->view->render('cart', ['products' => $products, 'error' => 'Checkout failed. Check stock levels and try again.']);
        }
    }

    private function showOrder(int $orderId): void
    {
        $buyer = $this->auth->requireRole('buyer');
        $order = $this->repository->orderForBuyer((int) $buyer['id'], $orderId);
        if (!$order) {
            http_response_code(404);
            $this->view->render('not_found');
            return;
        }
        $this->view->render('order_detail', [
            'order' => $order,
            'items' => $this->repository->orderItemsForBuyer((int) $buyer['id'], $orderId),
        ]);
    }
}
