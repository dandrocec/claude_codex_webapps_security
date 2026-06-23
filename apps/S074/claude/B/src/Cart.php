<?php

declare(strict_types=1);

namespace App;

/**
 * Session-backed cart. A single cart spans products from any number of vendors;
 * vendor separation happens later when the order is split into per-vendor items.
 *
 * The cart only stores product_id => quantity. Prices and stock are always
 * re-read from the database at render/checkout time so a stale or tampered
 * client value can never set the price.
 */
final class Cart
{
    private const KEY = '__cart';

    /** @return array<int,int> product_id => quantity */
    public static function items(): array
    {
        $cart = Session::get(self::KEY, []);
        return is_array($cart) ? $cart : [];
    }

    public static function add(int $productId, int $quantity): void
    {
        if ($productId <= 0 || $quantity <= 0) {
            return;
        }
        $cart = self::items();
        $cart[$productId] = min(99, ($cart[$productId] ?? 0) + $quantity);
        Session::set(self::KEY, $cart);
    }

    public static function set(int $productId, int $quantity): void
    {
        $cart = self::items();
        if ($quantity <= 0) {
            unset($cart[$productId]);
        } else {
            $cart[$productId] = min(99, $quantity);
        }
        Session::set(self::KEY, $cart);
    }

    public static function remove(int $productId): void
    {
        $cart = self::items();
        unset($cart[$productId]);
        Session::set(self::KEY, $cart);
    }

    public static function clear(): void
    {
        Session::forget(self::KEY);
    }

    public static function count(): int
    {
        return array_sum(self::items());
    }
}
