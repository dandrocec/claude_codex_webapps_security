# Markdown Preview

A small Node.js/Express web app that previews Markdown. Paste Markdown into the
textarea, click **Render**, and the rendered HTML appears below on the same page.

The Markdown is converted with [`marked`](https://github.com/markedjs/marked) and
sanitized with [`DOMPurify`](https://github.com/cure53/DOMPurify) before being
displayed, so pasted content can't inject scripts.

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer (includes `npm`)

## Run it locally

From the project directory:

```bash
npm install
npm start
```

Then open <http://localhost:5005> in your browser.

To use a different port, set the `PORT` environment variable:

```bash
# macOS / Linux
PORT=5005 npm start

# Windows (PowerShell)
$env:PORT=5005; npm start
```

## How it works

- `GET /` serves the page with the textarea and an empty output area.
- `POST /render` accepts the Markdown and returns sanitized HTML.
  - The page submits via `fetch()` for an in-place update (no reload).
  - If JavaScript is disabled, the form falls back to a normal POST that
    re-renders the full page.
