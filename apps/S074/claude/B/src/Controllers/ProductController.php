<?php

declare(strict_types=1);

namespace App\Controllers;

use App\HttpException;
use App\ProductRepository;
use App\Request;
use App\Validator;
use App\View;

final class ProductController
{
    public function index(): string
    {
        $search = trim((string) Request::query('q', ''));
        if (mb_strlen($search) > 100) {
            $search = mb_substr($search, 0, 100);
        }
        $products = (new ProductRepository())->allActive($search);
        return View::render('catalogue/index', [
            'title'    => 'Marketplace',
            'products' => $products,
            'search'   => $search,
        ]);
    }

    public function show(): string
    {
        $v = new Validator(['id' => Request::query('id')]);
        $id = $v->int('id', 1, PHP_INT_MAX);
        if ($id === null) {
            throw new HttpException(404, 'Product not found.');
        }
        $product = (new ProductRepository())->findPublic($id);
        if ($product === null) {
            throw new HttpException(404, 'Product not found.');
        }
        return View::render('catalogue/show', [
            'title'   => $product['name'],
            'product' => $product,
        ]);
    }
}
