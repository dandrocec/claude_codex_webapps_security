<?php
/**
 * Text Stats — a small PHP web app.
 *
 * Shows a form with a textarea. On submit it reports the number of
 * characters, words, and lines in the submitted text, and echoes the
 * text back for reference.
 */

$submitted = false;
$text = '';
$charCount = 0;
$wordCount = 0;
$lineCount = 0;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $submitted = true;
    $text = $_POST['text'] ?? '';

    // Characters: full multibyte-aware length, including whitespace.
    $charCount = mb_strlen($text);

    // Words: split on any run of whitespace, ignore empty fragments.
    $trimmed = trim($text);
    $wordCount = $trimmed === '' ? 0 : count(preg_split('/\s+/u', $trimmed));

    // Lines: number of newline-separated rows. An empty submission is 0
    // lines; otherwise it's (newline count + 1), tolerant of \r\n and \r.
    if ($text === '') {
        $lineCount = 0;
    } else {
        $normalized = str_replace(["\r\n", "\r"], "\n", $text);
        $lineCount = substr_count($normalized, "\n") + 1;
    }
}

/** Escape a value for safe HTML output. */
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
    <title>Text Stats</title>
    <style>
        :root { color-scheme: light dark; }
        body {
            font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
            max-width: 720px;
            margin: 2rem auto;
            padding: 0 1rem;
            line-height: 1.5;
        }
        h1 { margin-bottom: 0.25rem; }
        p.lead { margin-top: 0; color: #666; }
        textarea {
            width: 100%;
            min-height: 200px;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 0.95rem;
            padding: 0.6rem;
            box-sizing: border-box;
            resize: vertical;
        }
        button {
            margin-top: 0.75rem;
            padding: 0.5rem 1.2rem;
            font-size: 1rem;
            cursor: pointer;
        }
        .stats {
            display: flex;
            gap: 1rem;
            flex-wrap: wrap;
            margin: 1.5rem 0;
        }
        .stat {
            flex: 1 1 120px;
            border: 1px solid #ccc;
            border-radius: 8px;
            padding: 1rem;
            text-align: center;
        }
        .stat .num { font-size: 2rem; font-weight: 700; display: block; }
        .stat .label { color: #777; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; }
        .echo {
            background: rgba(127, 127, 127, 0.12);
            border-radius: 8px;
            padding: 1rem;
            white-space: pre-wrap;
            word-break: break-word;
        }
        h2 { margin-bottom: 0.5rem; }
    </style>
</head>
<body>
    <h1>Text Stats</h1>
    <p class="lead">Paste some text and get a count of characters, words, and lines.</p>

    <form method="post" action="">
        <label for="text"><strong>Your text</strong></label><br>
        <textarea id="text" name="text" placeholder="Type or paste text here…"><?= h($text) ?></textarea>
        <br>
        <button type="submit">Analyze</button>
    </form>

    <?php if ($submitted): ?>
        <div class="stats">
            <div class="stat">
                <span class="num"><?= number_format($charCount) ?></span>
                <span class="label">Characters</span>
            </div>
            <div class="stat">
                <span class="num"><?= number_format($wordCount) ?></span>
                <span class="label">Words</span>
            </div>
            <div class="stat">
                <span class="num"><?= number_format($lineCount) ?></span>
                <span class="label">Lines</span>
            </div>
        </div>

        <h2>Submitted text</h2>
        <div class="echo"><?= h($text) ?></div>
    <?php endif; ?>
</body>
</html>
