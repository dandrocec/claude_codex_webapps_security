<?php
// Shared storage helpers. Submissions are appended to a JSON-lines file,
// one JSON object per line, so the file is both append-friendly and easy to read back.

const DATA_DIR  = __DIR__ . '/data';
const DATA_FILE = DATA_DIR . '/submissions.jsonl';

/**
 * Append a single submission to the data file.
 */
function save_submission(array $submission): void
{
    if (!is_dir(DATA_DIR)) {
        mkdir(DATA_DIR, 0775, true);
    }

    $record = [
        'name'       => $submission['name'],
        'email'      => $submission['email'],
        'message'    => $submission['message'],
        'created_at' => date('c'),
    ];

    $line = json_encode($record, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
    file_put_contents(DATA_FILE, $line, FILE_APPEND | LOCK_EX);
}

/**
 * Read every submission back, newest first.
 *
 * @return array<int, array<string, string>>
 */
function load_submissions(): array
{
    if (!is_file(DATA_FILE)) {
        return [];
    }

    $submissions = [];
    $lines = file(DATA_FILE, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $record = json_decode($line, true);
        if (is_array($record)) {
            $submissions[] = $record;
        }
    }

    return array_reverse($submissions);
}
