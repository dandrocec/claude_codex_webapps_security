<?php
$submittedText = '';
$stats = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $submittedText = isset($_POST['text']) ? (string) $_POST['text'] : '';

    $characters = mb_strlen($submittedText, 'UTF-8');
    $trimmedText = trim($submittedText);
    $words = $trimmedText === '' ? 0 : str_word_count($trimmedText);
    $lines = $submittedText === '' ? 0 : substr_count($submittedText, "\n") + 1;

    $stats = [
        'characters' => $characters,
        'words' => $words,
        'lines' => $lines,
    ];
}
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Text Counter</title>
    <style>
        :root {
            color-scheme: light;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: #f6f7f9;
            color: #1d232a;
        }

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            min-height: 100vh;
            display: flex;
            align-items: flex-start;
            justify-content: center;
            padding: 48px 18px;
        }

        main {
            width: min(920px, 100%);
        }

        h1 {
            margin: 0 0 10px;
            font-size: clamp(2rem, 4vw, 3.1rem);
            line-height: 1.05;
            letter-spacing: 0;
        }

        .intro {
            margin: 0 0 28px;
            color: #52606d;
            font-size: 1.05rem;
        }

        form,
        .results {
            background: #ffffff;
            border: 1px solid #dde3ea;
            border-radius: 8px;
            box-shadow: 0 16px 40px rgba(29, 35, 42, 0.08);
        }

        form {
            padding: 22px;
        }

        label {
            display: block;
            margin-bottom: 10px;
            font-weight: 700;
        }

        textarea {
            width: 100%;
            min-height: 240px;
            resize: vertical;
            border: 1px solid #b8c2cc;
            border-radius: 6px;
            padding: 14px;
            font: 1rem/1.5 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
            color: #1d232a;
        }

        textarea:focus {
            outline: 3px solid #8ecae6;
            border-color: #2374ab;
        }

        button {
            margin-top: 14px;
            border: 0;
            border-radius: 6px;
            background: #176b87;
            color: #ffffff;
            cursor: pointer;
            font-weight: 700;
            font-size: 1rem;
            padding: 12px 18px;
        }

        button:hover,
        button:focus {
            background: #12556b;
        }

        .results {
            margin-top: 22px;
            padding: 22px;
        }

        .stats {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 14px;
            margin-bottom: 22px;
        }

        .stat {
            border: 1px solid #dde3ea;
            border-radius: 8px;
            padding: 16px;
            background: #fafbfd;
        }

        .stat span {
            display: block;
            color: #52606d;
            font-size: 0.9rem;
            margin-bottom: 6px;
        }

        .stat strong {
            display: block;
            font-size: 2rem;
            line-height: 1;
        }

        h2 {
            margin: 0 0 12px;
            font-size: 1.2rem;
        }

        pre {
            margin: 0;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
            border: 1px solid #dde3ea;
            border-radius: 6px;
            background: #f6f7f9;
            padding: 14px;
            min-height: 80px;
            font: 1rem/1.5 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
        }

        @media (max-width: 700px) {
            body {
                padding: 28px 14px;
            }

            .stats {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <main>
        <h1>Text Counter</h1>
        <p class="intro">Paste text to count its characters, words, and lines.</p>

        <form method="post" action="">
            <label for="text">Text to analyze</label>
            <textarea id="text" name="text" placeholder="Paste or type text here..."><?= htmlspecialchars($submittedText, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') ?></textarea>
            <button type="submit">Count text</button>
        </form>

        <?php if ($stats !== null): ?>
            <section class="results" aria-live="polite">
                <div class="stats">
                    <div class="stat">
                        <span>Characters</span>
                        <strong><?= number_format($stats['characters']) ?></strong>
                    </div>
                    <div class="stat">
                        <span>Words</span>
                        <strong><?= number_format($stats['words']) ?></strong>
                    </div>
                    <div class="stat">
                        <span>Lines</span>
                        <strong><?= number_format($stats['lines']) ?></strong>
                    </div>
                </div>

                <h2>Submitted text</h2>
                <pre><?= htmlspecialchars($submittedText, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') ?></pre>
            </section>
        <?php endif; ?>
    </main>
</body>
</html>
