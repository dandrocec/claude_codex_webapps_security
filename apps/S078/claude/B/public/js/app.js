'use strict';

// Confirmation prompts for destructive actions.
// Kept in an external file so the Content-Security-Policy can forbid inline
// scripts (no 'unsafe-inline'), which is a stronger XSS defence.
document.addEventListener('submit', function (event) {
  var form = event.target;
  if (form.matches('[data-confirm]')) {
    var message = form.getAttribute('data-confirm') || 'Are you sure?';
    if (!window.confirm(message)) {
      event.preventDefault();
    }
  }
});
