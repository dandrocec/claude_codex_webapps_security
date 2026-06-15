'use strict';

const express = require('express');
const app = express();
const PORT = process.env.PORT || 5020;

app.use(express.urlencoded({ extended: false, limit: '1mb' }));

/**
 * Try to derive a human-friendly line/column from a JSON.parse error.
 * Different Node versions phrase the message differently, but most include
 * "... at position N" (and newer ones already include line/column).
 */
function describeError(err, source) {
  let message = err.message;

  const posMatch = message.match(/at position (\d+)/);
  if (posMatch) {
    const pos = Number(posMatch[1]);
    const upToError = source.slice(0, pos);
    const line = upToError.split('\n').length;
    const column = pos - upToError.lastIndexOf('\n');
    if (!/line \d+ column \d+/.test(message)) {
      message += ` (line ${line}, column ${column})`;
    }
  }

  return message;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPage({ input = '', result = null } = {}) {
  let resultBlock = '';

  if (result && result.ok) {
    resultBlock = `
      <div class="panel success">
        <h2>✓ Valid JSON</h2>
        <pre>${escapeHtml(result.pretty)}</pre>
      </div>`;
  } else if (result && !result.ok) {
    resultBlock = `
      <div class="panel error">
        <h2>✗ Invalid JSON</h2>
        <p>${escapeHtml(result.message)}</p>
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>JSON Validator &amp; Formatter</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      max-width: 820px;
      margin: 0 auto;
      padding: 2rem 1.25rem 4rem;
      line-height: 1.5;
    }
    h1 { margin-bottom: 0.25rem; }
    p.lede { margin-top: 0; color: #666; }
    textarea {
      width: 100%;
      min-height: 240px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 14px;
      padding: 0.75rem;
      border: 1px solid #bbb;
      border-radius: 8px;
      resize: vertical;
    }
    button {
      margin-top: 0.75rem;
      padding: 0.6rem 1.4rem;
      font-size: 15px;
      border: 0;
      border-radius: 8px;
      background: #2563eb;
      color: #fff;
      cursor: pointer;
    }
    button:hover { background: #1d4ed8; }
    .panel {
      margin-top: 1.5rem;
      padding: 1rem 1.25rem;
      border-radius: 8px;
      border: 1px solid;
    }
    .panel h2 { margin-top: 0; font-size: 1.05rem; }
    .success { border-color: #16a34a; background: rgba(22,163,74,0.08); }
    .error   { border-color: #dc2626; background: rgba(220,38,38,0.08); }
    .error p { font-family: ui-monospace, Consolas, monospace; margin: 0; }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <h1>JSON Validator &amp; Formatter</h1>
  <p class="lede">Paste JSON below and submit. You'll get a neatly indented version, or an explanation of what went wrong.</p>

  <form method="POST" action="/">
    <textarea name="json" placeholder='{ "hello": "world" }' autofocus>${escapeHtml(input)}</textarea>
    <br />
    <button type="submit">Validate &amp; Format</button>
  </form>

  ${resultBlock}
</body>
</html>`;
}

app.get('/', (req, res) => {
  res.send(renderPage());
});

app.post('/', (req, res) => {
  const input = (req.body && req.body.json) || '';

  if (input.trim() === '') {
    return res.send(renderPage({
      input,
      result: { ok: false, message: 'Please paste some JSON before submitting.' },
    }));
  }

  try {
    const parsed = JSON.parse(input);
    const pretty = JSON.stringify(parsed, null, 2);
    res.send(renderPage({ input, result: { ok: true, pretty } }));
  } catch (err) {
    res.send(renderPage({
      input,
      result: { ok: false, message: describeError(err, input) },
    }));
  }
});

app.listen(PORT, () => {
  console.log(`JSON validator running at http://localhost:${PORT}`);
});
