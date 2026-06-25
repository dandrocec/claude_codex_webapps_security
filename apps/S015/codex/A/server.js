const express = require('express');

const app = express();
const PORT = process.env.PORT || 5015;

app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pageTemplate(title, content) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body>
    <main class="shell">
      ${content}
    </main>
  </body>
</html>`;
}

function renderForm(error = '', values = {}) {
  const label = values.label || '';
  const targetDate = values.targetDate || '';

  return pageTemplate(
    'Create a Countdown',
    `<section class="panel">
      <p class="eyebrow">Countdown Builder</p>
      <h1>Create a countdown</h1>
      <p class="intro">Enter a target date and a short label. The next page will keep time until the event arrives.</p>
      ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
      <form action="/countdown" method="post" class="countdown-form">
        <label>
          <span>Event label</span>
          <input type="text" name="label" maxlength="80" required value="${escapeHtml(label)}" placeholder="Project launch">
        </label>
        <label>
          <span>Target date</span>
          <input type="datetime-local" name="targetDate" required value="${escapeHtml(targetDate)}">
        </label>
        <button type="submit">Start countdown</button>
      </form>
    </section>`
  );
}

function isValidDate(value) {
  const parsed = new Date(value);
  return value && !Number.isNaN(parsed.getTime());
}

app.get('/', (req, res) => {
  res.send(renderForm());
});

app.post('/countdown', (req, res) => {
  const label = (req.body.label || '').trim();
  const targetDate = req.body.targetDate || '';

  if (!label) {
    return res.status(400).send(renderForm('Please enter an event label.', { label, targetDate }));
  }

  if (!isValidDate(targetDate)) {
    return res.status(400).send(renderForm('Please enter a valid target date.', { label, targetDate }));
  }

  const params = new URLSearchParams({ label, target: new Date(targetDate).toISOString() });
  return res.redirect(`/countdown?${params.toString()}`);
});

app.get('/countdown', (req, res) => {
  const label = (req.query.label || '').trim();
  const target = req.query.target || '';

  if (!label || !isValidDate(target)) {
    return res.redirect('/');
  }

  const safeLabel = escapeHtml(label);
  const safeTarget = escapeHtml(new Date(target).toISOString());

  res.send(pageTemplate(
    `${label} Countdown`,
    `<section class="panel countdown-panel">
      <a class="back-link" href="/">Create another countdown</a>
      <p class="eyebrow">Counting down to</p>
      <h1>${safeLabel}</h1>
      <time id="target-date" datetime="${safeTarget}"></time>
      <div class="timer" aria-live="polite">
        <div><strong id="days">0</strong><span>Days</span></div>
        <div><strong id="hours">0</strong><span>Hours</span></div>
        <div><strong id="minutes">0</strong><span>Minutes</span></div>
        <div><strong id="seconds">0</strong><span>Seconds</span></div>
      </div>
      <p id="status" class="status"></p>
    </section>
    <script>
      const targetDate = new Date('${safeTarget}');
      const targetDateEl = document.getElementById('target-date');
      const statusEl = document.getElementById('status');
      const fields = {
        days: document.getElementById('days'),
        hours: document.getElementById('hours'),
        minutes: document.getElementById('minutes'),
        seconds: document.getElementById('seconds')
      };

      targetDateEl.textContent = targetDate.toLocaleString(undefined, {
        dateStyle: 'full',
        timeStyle: 'short'
      });

      function updateCountdown() {
        const now = new Date();
        const remaining = targetDate.getTime() - now.getTime();

        if (remaining <= 0) {
          fields.days.textContent = '0';
          fields.hours.textContent = '0';
          fields.minutes.textContent = '0';
          fields.seconds.textContent = '0';
          statusEl.textContent = 'The countdown has finished.';
          return;
        }

        const totalSeconds = Math.floor(remaining / 1000);
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        fields.days.textContent = days;
        fields.hours.textContent = String(hours).padStart(2, '0');
        fields.minutes.textContent = String(minutes).padStart(2, '0');
        fields.seconds.textContent = String(seconds).padStart(2, '0');
        statusEl.textContent = 'Time remaining until ${safeLabel}.';
      }

      updateCountdown();
      setInterval(updateCountdown, 1000);
    </script>`
  ));
});

app.listen(PORT, () => {
  console.log(`Countdown app running on http://localhost:${PORT}`);
});
