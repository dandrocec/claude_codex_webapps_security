<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Auth;
use App\Cart;
use App\Http;
use App\OrderRepository;
use App\Session;
use App\View;

final class OrderController
{
    public function checkout(): string
    {
        Http::requireBuyer();

        $result = (new OrderRepository())->checkout((int) Auth::id(), Cart::items());
        if (!$result['ok']) {
            Session::flash($result['error'] ?? 'Checkout failed.', 'error');
            return Http::redirect('/cart');
        }

        Cart::clear();
        Session::flash('Order #' . $result['orderId'] . ' placed successfully. Thank you!', 'success');
        return Http::redirect('/orders');
    }

    public function index(): string
    {
        Http::requireBuyer();
        $orders = (new OrderRepository())->forBuyer((int) Auth::id());
        return View::render('orders/index', [
            'title'  => 'My orders',
            'orders' => $orders,
        ]);
    }
}
