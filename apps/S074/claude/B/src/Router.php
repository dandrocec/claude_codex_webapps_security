<?php

declare(strict_types=1);

namespace App;

/**
 * Very small exact-match router. Routes are registered as
 * (METHOD, PATH) => callable. POST routes are automatically CSRF-protected.
 */
final class Router
{
    /** @var array<string,callable> */
    private array $routes = [];

    public function get(string $path, callable $handler): void
    {
        $this->routes['GET ' . $path] = $handler;
    }

    public function post(string $path, callable $handler): void
    {
        $this->routes['POST ' . $path] = $handler;
    }

    public function dispatch(): string
    {
        $method = Request::method();
        $path   = Request::path();

        // CSRF check for every state-changing request (OWASP A01).
        if ($method === 'POST' && !Csrf::verify(Request::postValue('csrf_token'))) {
            return $this->errorPage(419, 'Your session has expired or the form token was invalid. Please try again.');
        }

        $key = $method . ' ' . $path;
        if (isset($this->routes[$key])) {
            return (string) ($this->routes[$key])();
        }

        // Method-not-allowed vs not-found.
        foreach ($this->routes as $routeKey => $_handler) {
            if (str_ends_with($routeKey, ' ' . $path)) {
                return $this->errorPage(405, 'Method not allowed.');
            }
        }

        return $this->errorPage(404, 'The page you were looking for does not exist.');
    }

    private function errorPage(int $status, string $message): string
    {
        return View::render('error', [
            'title'   => 'Error ' . $status,
            'status'  => $status,
            'message' => $message,
        ], $status);
    }
}
