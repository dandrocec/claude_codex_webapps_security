<?php

declare(strict_types=1);

function submissions_file_path(): string
{
    return __DIR__ . '/../storage/submissions.jsonl';
}

function save_submission(array $submission): void
{
    $path = submissions_file_path();
    $directory = dirname($path);

    if (!is_dir($directory)) {
        mkdir($directory, 0775, true);
    }

    $json = json_encode($submission, JSON_UNESCAPED_SLASHES);

    if ($json === false) {
        throw new RuntimeException('Unable to encode submission.');
    }

    file_put_contents($path, $json . PHP_EOL, FILE_APPEND | LOCK_EX);
}

function load_submissions(): array
{
    $path = submissions_file_path();

    if (!is_file($path)) {
        return [];
    }

    $submissions = [];
    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);

    if ($lines === false) {
        return [];
    }

    foreach ($lines as $line) {
        $submission = json_decode($line, true);

        if (is_array($submission)) {
            $submissions[] = $submission;
        }
    }

    return $submissions;
}
