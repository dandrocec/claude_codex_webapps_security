<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    render_error('Method not allowed.');
}

if (!csrf_verify($_POST['csrf_token'] ?? '')) {
    http_response_code(403);
    render_error('The form expired. Please go back and try again.');
}

$name = clean_text($_POST['name'] ?? '', 120);
$email = clean_email($_POST['email'] ?? '');
$message = clean_text($_POST['message'] ?? '', 4000);

$errors = [];
if ($name === '') {
    $errors[] = 'Name is required.';
}
if ($email === null) {
    $errors[] = 'A valid email address is required.';
}
if ($message === '') {
    $errors[] = 'Message is required.';
}

if ($errors !== []) {
    render_header('Contact error');
    echo '<main class="shell"><h1>Please fix the form</h1><div class="panel">';
    foreach ($errors as $error) {
        echo '<p>' . e($error) . '</p>';
    }
    echo '<p><a href="/">Return to the contact form</a></p></div></main>';
    render_footer();
    exit;
}

try {
    submissions()->save($name, $email, $message);
} catch (Throwable $exception) {
    error_log($exception);
    http_response_code(500);
    render_error('We could not save your message right now.');
}

header('Location: /thanks.php', true, 303);
exit;
