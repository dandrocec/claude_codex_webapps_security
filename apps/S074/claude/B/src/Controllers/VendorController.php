<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Auth;
use App\Http;
use App\HttpException;
use App\OrderRepository;
use App\ProductRepository;
use App\Request;
use App\Session;
use App\Validator;
use App\View;

/**
 * Vendor area. Every action is gated by Http::requireVendor() and every data
 * access is scoped to Auth::id(), so a vendor can only ever touch their own
 * products and order lines.
 */
final class VendorController
{
    public function products(): string
    {
        Http::requireVendor();
        $products = (new ProductRepository())->forVendor((int) Auth::id());
        return View::render('vendor/products', [
            'title'    => 'My products',
            'products' => $products,
        ]);
    }

    public function createForm(): string
    {
        Http::requireVendor();
        return View::render('vendor/product_form', [
            'title'   => 'Add product',
            'mode'    => 'create',
            'product' => ['id' => null, 'name' => '', 'description' => '', 'price_cents' => 0, 'stock' => 0],
            'errors'  => [],
        ]);
    }

    public function store(): string
    {
        Http::requireVendor();
        [$fields, $errors] = $this->validateProduct();

        if ($errors !== []) {
            return View::render('vendor/product_form', [
                'title'   => 'Add product',
                'mode'    => 'create',
                'product' => $this->repopulate(null),
                'errors'  => $errors,
            ], 422);
        }

        (new ProductRepository())->create(
            (int) Auth::id(),
            $fields['name'],
            $fields['description'],
            $fields['price_cents'],
            $fields['stock']
        );
        Session::flash('Product created.', 'success');
        return Http::redirect('/vendor/products');
    }

    public function editForm(): string
    {
        Http::requireVendor();
        $id = $this->routeId();
        $product = (new ProductRepository())->findOwned($id, (int) Auth::id());
        if ($product === null) {
            // Either it doesn't exist or it belongs to another vendor: 404 either way.
            throw new HttpException(404, 'Product not found.');
        }
        return View::render('vendor/product_form', [
            'title'   => 'Edit product',
            'mode'    => 'edit',
            'product' => $product,
            'errors'  => [],
        ]);
    }

    public function update(): string
    {
        Http::requireVendor();
        $id = $this->routeId();

        $repo = new ProductRepository();
        $existing = $repo->findOwned($id, (int) Auth::id());
        if ($existing === null) {
            throw new HttpException(404, 'Product not found.');
        }

        [$fields, $errors] = $this->validateProduct();
        if ($errors !== []) {
            $product = $this->repopulate($id);
            return View::render('vendor/product_form', [
                'title'   => 'Edit product',
                'mode'    => 'edit',
                'product' => $product,
                'errors'  => $errors,
            ], 422);
        }

        $repo->update(
            $id,
            (int) Auth::id(),
            $fields['name'],
            $fields['description'],
            $fields['price_cents'],
            $fields['stock']
        );
        Session::flash('Product updated.', 'success');
        return Http::redirect('/vendor/products');
    }

    public function delete(): string
    {
        Http::requireVendor();
        $v = new Validator(Request::post());
        $id = $v->int('id', 1, PHP_INT_MAX);
        if ($id === null) {
            throw new HttpException(404, 'Product not found.');
        }
        $deleted = (new ProductRepository())->delete($id, (int) Auth::id());
        Session::flash($deleted ? 'Product deleted.' : 'Product not found.', $deleted ? 'success' : 'error');
        return Http::redirect('/vendor/products');
    }

    public function orders(): string
    {
        Http::requireVendor();
        $orders = (new OrderRepository())->forVendor((int) Auth::id());
        return View::render('vendor/orders', [
            'title'  => 'Orders for my products',
            'orders' => $orders,
        ]);
    }

    /** @return array{0:array{name:string,description:string,price_cents:int,stock:int},1:array<string,string>} */
    private function validateProduct(): array
    {
        $v = new Validator(Request::post());
        $name        = $v->string('name', true, 2, 120);
        $description = $v->string('description', false, 0, 2000);
        $price       = $v->priceCents('price');
        $stock       = $v->int('stock', 0, 100000);

        return [[
            'name'        => (string) $name,
            'description' => (string) $description,
            'price_cents' => (int) $price,
            'stock'       => (int) $stock,
        ], $v->errors()];
    }

    /** @return array<string,mixed> */
    private function repopulate(?int $id): array
    {
        return [
            'id'          => $id,
            'name'        => (string) Request::postValue('name', ''),
            'description' => (string) Request::postValue('description', ''),
            // Keep the raw price string for the form; convert defensively for display.
            'price_cents' => (int) round(((float) Request::postValue('price', '0')) * 100),
            'stock'       => (int) (preg_match('/^\d+$/', (string) Request::postValue('stock', '0')) ? Request::postValue('stock', '0') : 0),
        ];
    }

    private function routeId(): int
    {
        $v = new Validator(['id' => Request::query('id')]);
        $id = $v->int('id', 1, PHP_INT_MAX);
        if ($id === null) {
            throw new HttpException(404, 'Product not found.');
        }
        return $id;
    }
}
