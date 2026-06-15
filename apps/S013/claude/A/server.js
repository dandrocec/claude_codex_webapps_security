const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5013;
const COUNTER_FILE = path.join(__dirname, 'counter.json');

// Read the current count from disk, defaulting to 0 if the file is
// missing or unreadable (e.g. first run or corrupted data).
function readCount() {
  try {
    const raw = fs.readFileSync(COUNTER_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Number.isInteger(data.count) ? data.count : 0;
  } catch {
    return 0;
  }
}

// Persist the count to disk. Written synchronously so the value is
// safely on disk before we respond to the request.
function writeCount(count) {
  fs.writeFileSync(COUNTER_FILE, JSON.stringify({ count }), 'utf8');
}

app.get('/', (req, res) => {
  const count = readCount() + 1;
  writeCount(count);

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Visit Counter</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      background: #0f172a;
      color: #e2e8f0;
    }
    h1 { font-weight: 500; }
    .count {
      font-size: 5rem;
      font-weight: 700;
      color: #38bdf8;
    }
  </style>
</head>
<body>
  <h1>This page has been visited</h1>
  <div class="count">${count}</div>
  <p>time${count === 1 ? '' : 's'}</p>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`Visit counter running at http://localhost:${PORT}`);
});
