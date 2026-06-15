'use strict';

// CSP-safe confirmation prompts. Any form with a data-confirm attribute asks
// the user before submitting. Kept in an external file so no inline scripts or
// event handlers are needed (the Content-Security-Policy forbids them).
document.addEventListener('submit', function (event) {
  var form = event.target;
  if (form instanceof HTMLFormElement && form.hasAttribute('data-confirm')) {
    if (!window.confirm(form.getAttribute('data-confirm'))) {
      event.preventDefault();
    }
  }
});
