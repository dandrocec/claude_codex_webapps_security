'use strict';

// CSP-friendly confirmation for destructive forms (no inline handlers).
document.addEventListener('submit', function (e) {
  const form = e.target;
  const message = form && form.getAttribute && form.getAttribute('data-confirm');
  if (message && !window.confirm(message)) {
    e.preventDefault();
  }
});
