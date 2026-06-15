'use strict';

const express = require('express');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5009;

// In-memory store: code -> original URL. Lives only for the process lifetime.
const urls = new Map();

app.use(express.urlencoded({ extended: false }));

// Generate a short, URL-safe code that isn't already taken.
function generateCode() {
  let code;
  do {
    code = crypto.randomBytes(4).toString('base64url').slice(0, 6);
  } while (urls.has(code));
  return code;
}

// Accept a URL only if it parses and uses http/https.
function normalizeUrl(input) {
  let value = (input || '').trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) {
    value = 'http://' + value;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPage(req, { newCode, error } = {}) {
  const base = `${req.protocol}://${req.get('host')}`;

  const rows = [...urls.entries()]
    .map(([code, target]) => {
      const shortUrl = `${base}/${code}`;
      return `<tr>
        <td><a href="/${escapeHtml(code)}">${escapeHtml(shortUrl)}</a></td>
        <td class="target"><a href="${escapeHtml(target)}">${escapeHtml(target)}</a></td>
      </tr>`;
    })
    .join('');

  const tableSection = urls.size
    ? `<table>
        <thead><tr><th>Short URL</th><th>Original URL</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`
    : `<p class="empty">No links yet — shorten one above.</p>`;

  const banner = error
    ? `<p class="msg error">${escapeHtml(error)}</p>`
    : newCode
      ? `<p class="msg ok">Created <a href="/${escapeHtml(newCode)}">${escapeHtml(base + '/' + newCode)}</a></p>`
      : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>URL Shortener</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 3rem auto; padding: 0 1rem; color: #1a1a1a; }
    h1 { margin-bottom: 0.25rem; }
    form { display: flex; gap: 0.5rem; margin: 1.5rem 0; }
    input[type=url], input[type=text] { flex: 1; padding: 0.6rem; font-size: 1rem; border: 1px solid #ccc; border-radius: 6px; }
    button { padding: 0.6rem 1.2rem; font-size: 1rem; border: 0; border-radius: 6px; background: #2563eb; color: #fff; cursor: pointer; }
    button:hover { background: #1d4ed8; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #eee; font-size: 0.95rem; }
    td.target { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .msg { padding: 0.6rem 0.8rem; border-radius: 6px; }
    .ok { background: #ecfdf5; color: #065f46; }
    .error { background: #fef2f2; color: #991b1b; }
    .empty { color: #666; }
  </style>
</head>
<body>
  <h1>URL Shortener</h1>
  <p>Paste a long link and get a short code. Links live in memory for this session.</p>
  ${banner}
  <form method="POST" action="/shorten">
    <input type="text" name="url" placeholder="https://example.com/very/long/path" autofocus required>
    <button type="submit">Shorten</button>
  </form>
  <h2>Links this session</h2>
  ${tableSection}
</body>
</html>`;
}

app.get('/', (req, res) => {
  res.send(renderPage(req));
});

app.post('/shorten', (req, res) => {
  const target = normalizeUrl(req.body.url);
  if (!target) {
    return res.status(400).send(renderPage(req, { error: 'Please enter a valid http(s) URL.' }));
  }
  const code = generateCode();
  urls.set(code, target);
  res.send(renderPage(req, { newCode: code }));
});

app.get('/:code', (req, res) => {
  const target = urls.get(req.params.code);
  if (!target) {
    return res.status(404).send('Unknown short code.');
  }
  res.redirect(target);
});

app.listen(PORT, () => {
  console.log(`URL shortener running at http://localhost:${PORT}`);
});
