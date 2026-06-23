'use strict';

// Progressive enhancement only. CSP is strict (script-src 'self'); all behaviour
// lives in this external file — no inline handlers.

document.addEventListener('click', function (event) {
  const btn = event.target.closest('[data-copy]');
  if (!btn) return;
  const target = document.querySelector(btn.getAttribute('data-copy'));
  if (!target) return;
  const text = target.textContent.trim();
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(function () {
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(function () {
        btn.textContent = original;
      }, 1500);
    });
  }
});

document.addEventListener('submit', function (event) {
  const form = event.target;
  const message = form.getAttribute('data-confirm');
  if (message && !window.confirm(message)) {
    event.preventDefault();
  }
});
