'use strict';

const express = require('express');

const app = express();
const PORT = process.env.PORT || 5015;

app.use(express.urlencoded({ extended: false }));

// Escape user-supplied text before embedding it in HTML.
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function pageShell(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: linear-gradient(135deg, #1e3c72, #2a5298);
      color: #fff;
    }
    .card {
      background: rgba(255, 255, 255, 0.08);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 16px;
      padding: 2.5rem;
      width: min(90vw, 520px);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
      text-align: center;
    }
    h1 { margin: 0 0 1.5rem; font-size: 1.6rem; }
    label { display: block; text-align: left; margin: 1rem 0 0.35rem; font-weight: 600; }
    input {
      width: 100%;
      padding: 0.7rem 0.9rem;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
    }
    button {
      margin-top: 1.5rem;
      width: 100%;
      padding: 0.8rem;
      border: none;
      border-radius: 8px;
      background: #ffcc00;
      color: #1e3c72;
      font-size: 1.05rem;
      font-weight: 700;
      cursor: pointer;
    }
    button:hover { background: #ffd633; }
    .event-label { font-size: 1.4rem; opacity: 0.9; margin-bottom: 1rem; }
    .timer { display: flex; gap: 1rem; justify-content: center; margin: 1.5rem 0; }
    .unit { min-width: 70px; }
    .unit .num { font-size: 2.6rem; font-weight: 700; line-height: 1; }
    .unit .lbl { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.75; }
    .done { font-size: 1.8rem; font-weight: 700; margin: 1.5rem 0; }
    a.back { color: #ffcc00; text-decoration: none; font-weight: 600; }
    .error { color: #ffb3b3; margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    ${body}
  </div>
</body>
</html>`;
}

function formPage(errorMessage) {
  const error = errorMessage ? `<p class="error">${escapeHtml(errorMessage)}</p>` : '';
  return pageShell('Create a Countdown', `
    <h1>⏳ Create a Countdown</h1>
    <form method="POST" action="/countdown">
      <label for="label">Event label</label>
      <input id="label" name="label" type="text" placeholder="New Year's Eve" required maxlength="120">
      <label for="target">Target date &amp; time</label>
      <input id="target" name="target" type="datetime-local" required>
      <button type="submit">Start Countdown</button>
    </form>
    ${error}
  `);
}

function countdownPage(label, targetIso) {
  return pageShell(`Countdown: ${label}`, `
    <p class="event-label">${escapeHtml(label)}</p>
    <div id="timer" class="timer"></div>
    <p id="done" class="done" style="display:none;">🎉 It's here! 🎉</p>
    <a class="back" href="/">← Make another countdown</a>
    <script>
      var target = new Date(${JSON.stringify(targetIso)}).getTime();
      var timerEl = document.getElementById('timer');
      var doneEl = document.getElementById('done');
      function render() {
        var diff = target - Date.now();
        if (diff <= 0) {
          timerEl.style.display = 'none';
          doneEl.style.display = 'block';
          clearInterval(handle);
          return;
        }
        var days = Math.floor(diff / 86400000);
        var hours = Math.floor((diff % 86400000) / 3600000);
        var mins = Math.floor((diff % 3600000) / 60000);
        var secs = Math.floor((diff % 60000) / 1000);
        var units = [[days, 'Days'], [hours, 'Hours'], [mins, 'Minutes'], [secs, 'Seconds']];
        timerEl.innerHTML = units.map(function (u) {
          return '<div class="unit"><div class="num">' + u[0] + '</div><div class="lbl">' + u[1] + '</div></div>';
        }).join('');
      }
      render();
      var handle = setInterval(render, 1000);
    </script>
  `);
}

app.get('/', (req, res) => {
  res.send(formPage());
});

app.post('/countdown', (req, res) => {
  const label = (req.body.label || '').trim();
  const target = (req.body.target || '').trim();
  const targetDate = new Date(target);

  if (!label || !target || Number.isNaN(targetDate.getTime())) {
    return res.status(400).send(formPage('Please provide a valid event label and target date.'));
  }

  res.send(countdownPage(label, targetDate.toISOString()));
});

app.listen(PORT, () => {
  console.log(`Countdown app running at http://localhost:${PORT}`);
});
