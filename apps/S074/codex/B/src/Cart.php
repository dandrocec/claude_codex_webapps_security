<?php

declare(strict_types=1);

namespace Marketplace;

final class Cart
{
    public function items(): array
    {
        return isset($_SESSION['cart']) && is_array($_SESSION['cart']) ? $_SESSION['cart'] : [];
    }

    public function count(): int
    {
        return array_sum(array_map('intval', $this->items()));
    }

    public function add(int $productId, int $quantity): void
    {
        $items = $this->items();
        $current = isset($items[$productId]) ? (int) $items[$productId] : 0;
        $items[$productId] = min(99, $current + $quantity);
        $_SESSION['cart'] = $items;
    }

    public function update(int $productId, int $quantity): void
    {
        $items = $this->items();
        if ($quantity <= 0) {
            unset($items[$productId]);
        } else {
            $items[$productId] = min(99, $quantity);
        }
        $_SESSION['cart'] = $items;
    }

    public function clear(): void
    {
        unset($_SESSION['cart']);
    }
}
