<?php
declare(strict_types=1);

namespace PhotoBlog;

final class App
{
    public function render(string $template, array $data = [], int $status = 200): void
    {
        http_response_code($status);
        extract($data, EXTR_SKIP);
        require dirname(__DIR__) . '/views/layout.php';
    }
}
