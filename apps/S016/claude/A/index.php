<?php
/**
 * Single-question poll app.
 *
 * Visitors pick one of three options and submit. Votes are persisted to a
 * JSON file on disk and the current tally is rendered for every option.
 */

declare(strict_types=1);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const POLL_QUESTION = 'What is your favorite programming language?';

/** @var array<string,string> Stable option keys mapped to display labels. */
const POLL_OPTIONS = [
    'php'    => 'PHP',
    'python' => 'Python',
    'js'     => 'JavaScript',
];

// File that holds the persisted vote counts.
$dataFile = __DIR__ . '/data/votes.json';

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

/**
 * Load vote counts from disk, guaranteeing one entry per known option.
 *
 * @return array<string,int>
 */
function load_votes(string $file): array
{
    $votes = [];
    if (is_file($file)) {
        $decoded = json_decode((string) file_get_contents($file), true);
        if (is_array($decoded)) {
            $votes = $decoded;
        }
    }

    // Normalize: every option present, integer counts, no stray keys.
    $normalized = [];
    foreach (array_keys(POLL_OPTIONS) as $key) {
        $normalized[$key] = isset($votes[$key]) ? (int) $votes[$key] : 0;
    }

    return $normalized;
}

/**
 * Persist vote counts to disk atomically.
 *
 * @param array<string,int> $votes
 */
function save_votes(string $file, array $votes): void
{
    $dir = dirname($file);
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }

    // Write to a temp file then rename so concurrent readers never see a
    // half-written file.
    $tmp = $file . '.' . getmypid() . '.tmp';
    file_put_contents($tmp, json_encode($votes, JSON_PRETTY_PRINT), LOCK_EX);
    rename($tmp, $file);
}

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

$justVoted = false;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $choice = $_POST['option'] ?? '';

    if (is_string($choice) && array_key_exists($choice, POLL_OPTIONS)) {
        $votes = load_votes($dataFile);
        $votes[$choice]++;
        save_votes($dataFile, $votes);
        $justVoted = true;
    }

    // Post/Redirect/Get: reload as a GET so a refresh doesn't double-vote.
    header('Location: ' . strtok($_SERVER['REQUEST_URI'], '?') . ($justVoted ? '?voted=1' : ''));
    exit;
}

$votes = load_votes($dataFile);
$total = array_sum($votes);
$justVoted = isset($_GET['voted']);

/** Escape helper for HTML output. */
function h(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Poll</title>
    <style>
        :root { --accent: #4f46e5; }
        * { box-sizing: border-box; }
        body {
            font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
            background: #f3f4f6;
            color: #111827;
            margin: 0;
            padding: 2rem 1rem;
        }
        .card {
            max-width: 480px;
            margin: 0 auto;
            background: #fff;
            border-radius: 12px;
            box-shadow: 0 1px 3px rgba(0,0,0,.1), 0 10px 30px rgba(0,0,0,.05);
            padding: 2rem;
        }
        h1 { font-size: 1.4rem; margin: 0 0 1.5rem; }
        .option { margin-bottom: .75rem; }
        .option label {
            display: flex;
            align-items: center;
            gap: .6rem;
            padding: .75rem 1rem;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            cursor: pointer;
            transition: border-color .15s, background .15s;
        }
        .option label:hover { border-color: var(--accent); background: #fafaff; }
        button {
            margin-top: 1rem;
            width: 100%;
            padding: .8rem;
            font-size: 1rem;
            font-weight: 600;
            color: #fff;
            background: var(--accent);
            border: none;
            border-radius: 8px;
            cursor: pointer;
        }
        button:hover { background: #4338ca; }
        .results { margin-top: 1.5rem; }
        .result { margin-bottom: 1rem; }
        .result-head {
            display: flex;
            justify-content: space-between;
            font-size: .9rem;
            margin-bottom: .35rem;
        }
        .bar {
            height: 10px;
            background: #e5e7eb;
            border-radius: 999px;
            overflow: hidden;
        }
        .bar > span {
            display: block;
            height: 100%;
            background: var(--accent);
            border-radius: 999px;
        }
        .total { margin-top: 1.25rem; font-size: .85rem; color: #6b7280; text-align: center; }
        .flash {
            background: #ecfdf5;
            color: #065f46;
            border: 1px solid #a7f3d0;
            border-radius: 8px;
            padding: .6rem .9rem;
            margin-bottom: 1.25rem;
            font-size: .9rem;
        }
    </style>
</head>
<body>
    <div class="card">
        <h1><?= h(POLL_QUESTION) ?></h1>

        <?php if ($justVoted): ?>
            <div class="flash">Thanks — your vote was recorded!</div>
        <?php endif; ?>

        <form method="post">
            <?php foreach (POLL_OPTIONS as $key => $label): ?>
                <div class="option">
                    <label>
                        <input type="radio" name="option" value="<?= h($key) ?>" required>
                        <span><?= h($label) ?></span>
                    </label>
                </div>
            <?php endforeach; ?>
            <button type="submit">Vote</button>
        </form>

        <div class="results">
            <?php foreach (POLL_OPTIONS as $key => $label): ?>
                <?php
                    $count   = $votes[$key];
                    $percent = $total > 0 ? round($count / $total * 100) : 0;
                ?>
                <div class="result">
                    <div class="result-head">
                        <span><?= h($label) ?></span>
                        <span><?= $count ?> vote<?= $count === 1 ? '' : 's' ?> (<?= $percent ?>%)</span>
                    </div>
                    <div class="bar"><span style="width: <?= $percent ?>%"></span></div>
                </div>
            <?php endforeach; ?>
        </div>

        <div class="total"><?= $total ?> total vote<?= $total === 1 ? '' : 's' ?></div>
    </div>
</body>
</html>
