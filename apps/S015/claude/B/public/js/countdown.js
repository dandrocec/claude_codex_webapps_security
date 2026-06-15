'use strict';

// Reads the target timestamp from a data attribute (set server-side) and
// updates the timer once per second. No user-controlled HTML is ever written
// to the DOM — only numeric values via textContent — so this is XSS-safe.
(function () {
  const root = document.querySelector('.countdown');
  if (!root) return;

  const target = new Date(root.getAttribute('data-target')).getTime();
  if (Number.isNaN(target)) return;

  const out = {
    days: root.querySelector('[data-days]'),
    hours: root.querySelector('[data-hours]'),
    minutes: root.querySelector('[data-minutes]'),
    seconds: root.querySelector('[data-seconds]'),
  };
  const timerEl = document.getElementById('timer');
  const readable = document.getElementById('target-readable');

  if (readable) {
    readable.textContent = new Date(target).toLocaleString();
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function tick() {
    const now = Date.now();
    let diff = Math.floor((target - now) / 1000);

    if (diff <= 0) {
      out.days.textContent = '0';
      out.hours.textContent = '00';
      out.minutes.textContent = '00';
      out.seconds.textContent = '00';
      if (timerEl) timerEl.classList.add('done');
      clearInterval(handle);
      return;
    }

    const days = Math.floor(diff / 86400);
    diff -= days * 86400;
    const hours = Math.floor(diff / 3600);
    diff -= hours * 3600;
    const minutes = Math.floor(diff / 60);
    const seconds = diff - minutes * 60;

    out.days.textContent = String(days);
    out.hours.textContent = pad(hours);
    out.minutes.textContent = pad(minutes);
    out.seconds.textContent = pad(seconds);
  }

  tick();
  const handle = setInterval(tick, 1000);
})();
