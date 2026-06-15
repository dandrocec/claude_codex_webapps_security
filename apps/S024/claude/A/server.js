'use strict';

const express = require('express');

const app = express();
const PORT = process.env.PORT || 5024;

// In-memory store of named redirects: key -> destination URL.
// Swap this for a database if you need persistence across restarts.
const redirects = new Map();

app.use(express.urlencoded({ extended: false }));

// --- Helpers ---------------------------------------------------------------

// Escape user-supplied text before embedding it in HTML to avoid stored XSS.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only allow http(s) destinations so a registered key can't smuggle in
// javascript: or data: URLs.
function normalizeDestination(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }
  return parsed.toString();
}

function layout(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
    h1 { font-size: 1.5rem; }
    nav a { margin-right: 1rem; }
    form { margin: 1.5rem 0; display: grid; gap: .75rem; max-width: 480px; }
    label { font-weight: 600; display: block; margin-bottom: .25rem; }
    input { width: 100%; padding: .5rem; box-sizing: border-box; font-size: 1rem; }
    button { padding: .5rem 1rem; font-size: 1rem; cursor: pointer; width: fit-content; }
    table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
    th, td { text-align: left; padding: .5rem; border-bottom: 1px solid #ddd; word-break: break-all; }
    code { background: #f2f2f2; padding: .1rem .3rem; border-radius: 3px; }
    .flash { padding: .75rem; border-radius: 4px; margin: 1rem 0; }
    .flash.ok { background: #e6f5ea; color: #1d6b34; }
    .flash.err { background: #fdeaea; color: #a12a2a; }
    .muted { color: #777; }
  </style>
</head>
<body>
  <nav>
    <a href="/">Redirects</a>
    <a href="/admin">Add redirect</a>
  </nav>
  ${body}
</body>
</html>`;
}

function flash(req) {
  const { ok, err } = req.query;
  if (ok) return `<div class="flash ok">${escapeHtml(ok)}</div>`;
  if (err) return `<div class="flash err">${escapeHtml(err)}</div>`;
  return '';
}

// --- Routes ----------------------------------------------------------------

// List all registered redirects.
app.get('/', (req, res) => {
  let rows;
  if (redirects.size === 0) {
    rows = `<tr><td colspan="3" class="muted">No redirects registered yet. <a href="/admin">Add one</a>.</td></tr>`;
  } else {
    rows = [...redirects.entries()]
      .map(([key, dest]) => {
        const link = `/go?to=${encodeURIComponent(key)}`;
        return `<tr>
          <td><code>${escapeHtml(key)}</code></td>
          <td><a href="${escapeHtml(dest)}">${escapeHtml(dest)}</a></td>
          <td><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></td>
        </tr>`;
      })
      .join('\n');
  }

  const body = `
    <h1>Registered redirects</h1>
    ${flash(req)}
    <table>
      <thead><tr><th>Key</th><th>Destination</th><th>Short link</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  res.send(layout('Registered redirects', body));
});

// Admin form to register a new redirect.
app.get('/admin', (req, res) => {
  const body = `
    <h1>Add a redirect</h1>
    ${flash(req)}
    <form method="POST" action="/admin">
      <div>
        <label for="key">Key</label>
        <input id="key" name="key" placeholder="docs" required>
      </div>
      <div>
        <label for="destination">Destination URL</label>
        <input id="destination" name="destination" type="url" placeholder="https://example.com/page" required>
      </div>
      <button type="submit">Register</button>
    </form>
    <p class="muted">Visitors reach it at <code>/go?to=&lt;key&gt;</code>.</p>`;
  res.send(layout('Add a redirect', body));
});

// Handle form submission.
app.post('/admin', (req, res) => {
  const key = (req.body.key || '').trim();
  const destination = normalizeDestination(req.body.destination);

  if (!key) {
    return res.redirect('/admin?err=' + encodeURIComponent('A key is required.'));
  }
  if (!destination) {
    return res.redirect('/admin?err=' + encodeURIComponent('Destination must be a valid http(s) URL.'));
  }

  const existed = redirects.has(key);
  redirects.set(key, destination);
  const msg = existed
    ? `Updated redirect "${key}".`
    : `Registered redirect "${key}".`;
  res.redirect('/?ok=' + encodeURIComponent(msg));
});

// Perform the redirect.
app.get('/go', (req, res) => {
  const key = (req.query.to || '').trim();
  const destination = redirects.get(key);
  if (!destination) {
    return res
      .status(404)
      .send(layout('Not found', `<h1>Unknown redirect</h1>
        <p>No redirect is registered for <code>${escapeHtml(key)}</code>.</p>
        <p><a href="/">See all redirects</a></p>`));
  }
  res.redirect(302, destination);
});

app.listen(PORT, () => {
  console.log(`Named redirects app running at http://localhost:${PORT}`);
});
