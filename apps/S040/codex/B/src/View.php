<?php

declare(strict_types=1);

namespace App;

use PDO;

final class View
{
    public static function render(string $template, array $data, PDO $db): void
    {
        $categories = $db->query('SELECT id, name FROM categories ORDER BY name')->fetchAll();
        extract($data, EXTR_SKIP);
        require dirname(__DIR__) . '/views/layout.php';
    }
}
