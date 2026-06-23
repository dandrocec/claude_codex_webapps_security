<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Cart;
use App\Http;
use App\ProductRepository;
use App\Request;
use App\Session;
use App\Validator;
use App\View;
use function App\money;

final class CartController
{
    public function show(): string
    {
        $repo = new ProductRepository();
        $rows = [];
        $total = 0;
        foreach (Cart::items() as $productId => $qty) {
            $product = $repo->findPublic((int) $productId);
            if ($product === null) {
                // Product vanished since it was added; drop it silently.
                Cart::remove((int) $productId);
                continue;
            }
            $qty = min((int) $qty, max(0, (int) $product['stock']));
            if ($qty <= 0) {
                Cart::remove((int) $productId);
                continue;
            }
            $lineTotal = (int) $product['price_cents'] * $qty;
            $total += $lineTotal;
            $rows[] = [
                'id'         => (int) $product['id'],
                'name'       => $product['name'],
                'vendor'     => $product['vendor_name'],
                'price_cents'=> (int) $product['price_cents'],
                'stock'      => (int) $product['stock'],
                'quantity'   => $qty,
                'line_total' => $lineTotal,
            ];
        }
        return View::render('cart/index', [
            'title'      => 'Your cart',
            'rows'       => $rows,
            'totalCents' => $total,
        ]);
    }

    public function add(): string
    {
        $v = new Validator(Request::post());
        $id  = $v->int('product_id', 1, PHP_INT_MAX);
        $qty = $v->int('quantity', 1, 99);

        if ($id === null || $qty === null) {
            Session::flash('Could not add that item to your cart.', 'error');
            return Http::redirect('/');
        }

        $product = (new ProductRepository())->findPublic($id);
        if ($product === null || (int) $product['stock'] <= 0) {
            Session::flash('That product is no longer available.', 'error');
            return Http::redirect('/');
        }

        Cart::add($id, $qty);
        Session::flash('Added to cart.', 'success');
        return Http::redirect('/cart');
    }

    public function update(): string
    {
        $v = new Validator(Request::post());
        $id  = $v->int('product_id', 1, PHP_INT_MAX);
        $qty = $v->int('quantity', 0, 99);
        if ($id !== null && $qty !== null) {
            Cart::set($id, $qty);
            Session::flash('Cart updated.', 'success');
        }
        return Http::redirect('/cart');
    }

    public function remove(): string
    {
        $v = new Validator(Request::post());
        $id = $v->int('product_id', 1, PHP_INT_MAX);
        if ($id !== null) {
            Cart::remove($id);
            Session::flash('Item removed.', 'success');
        }
        return Http::redirect('/cart');
    }
}
