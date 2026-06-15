const express = require('express');
const { marked } = require('marked');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

const app = express();
const PORT = process.env.PORT || 5005;

// Parse form-encoded bodies (from the textarea) and JSON (for the fetch API).
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Convert Markdown to sanitized HTML.
function renderMarkdown(markdown) {
  const rawHtml = marked.parse(markdown || '');
  return DOMPurify.sanitize(rawHtml);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page(markdown, rendered) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Markdown Preview</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
           max-width: 820px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
    h1 { font-size: 1.5rem; }
    textarea { width: 100%; min-height: 240px; font-family: ui-monospace, Menlo, Consolas, monospace;
               font-size: 0.95rem; padding: 0.75rem; box-sizing: border-box;
               border: 1px solid #ccc; border-radius: 6px; resize: vertical; }
    button { margin-top: 0.75rem; padding: 0.55rem 1.25rem; font-size: 1rem; cursor: pointer;
             background: #2563eb; color: #fff; border: none; border-radius: 6px; }
    button:hover { background: #1d4ed8; }
    .output { margin-top: 1.5rem; padding: 1rem 1.25rem; border: 1px solid #e2e2e2;
              border-radius: 6px; background: #fafafa; }
    .output h2 { margin-top: 0; }
    #rendered pre { background: #f0f0f0; padding: 0.75rem; border-radius: 6px; overflow-x: auto; }
    #rendered code { font-family: ui-monospace, Menlo, Consolas, monospace; }
    #rendered blockquote { border-left: 4px solid #ddd; margin-left: 0; padding-left: 1rem; color: #555; }
    #rendered table { border-collapse: collapse; }
    #rendered th, #rendered td { border: 1px solid #ccc; padding: 0.4rem 0.6rem; }
  </style>
</head>
<body>
  <h1>Markdown Preview</h1>
  <form id="md-form" method="post" action="/render">
    <textarea id="markdown" name="markdown" placeholder="Paste your Markdown here...">${escapeHtml(markdown)}</textarea>
    <br />
    <button type="submit">Render</button>
  </form>

  <div class="output">
    <h2>Rendered output</h2>
    <div id="rendered">${rendered}</div>
  </div>

  <script>
    // Progressive enhancement: render without a full page reload when JS is available.
    const form = document.getElementById('md-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const markdown = document.getElementById('markdown').value;
      const res = await fetch('/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown })
      });
      const data = await res.json();
      document.getElementById('rendered').innerHTML = data.html;
    });
  </script>
</body>
</html>`;
}

app.get('/', (req, res) => {
  res.send(page('', ''));
});

app.post('/render', (req, res) => {
  const markdown = req.body.markdown || '';
  const html = renderMarkdown(markdown);

  // JSON request from the fetch() enhancement.
  if (req.is('application/json')) {
    return res.json({ html });
  }

  // Plain form POST fallback (no JS) — re-render the whole page.
  res.send(page(markdown, html));
});

app.listen(PORT, () => {
  console.log(`Markdown preview app running at http://localhost:${PORT}`);
});
