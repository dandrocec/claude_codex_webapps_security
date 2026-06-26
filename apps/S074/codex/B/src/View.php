<?php

declare(strict_types=1);

namespace Marketplace;

final class View
{
    public function __construct(
        private readonly string $templatePath,
        private readonly Csrf $csrf,
        private readonly Auth $auth,
        private readonly Cart $cart,
    ) {
    }

    public function render(string $template, array $data = []): void
    {
        $templateFile = $this->templatePath . DIRECTORY_SEPARATOR . $template . '.php';
        if (!is_file($templateFile)) {
            throw new \RuntimeException('Template not found');
        }

        $csrf = $this->csrf;
        $auth = $this->auth;
        $cart = $this->cart;
        extract($data, EXTR_SKIP);
        require $this->templatePath . DIRECTORY_SEPARATOR . 'layout.php';
    }

    public function includeTemplate(string $templateFile): void
    {
        require $templateFile;
    }
}
