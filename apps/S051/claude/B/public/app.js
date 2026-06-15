// Loaded from a same-origin file so it complies with the strict CSP
// (script-src 'self'); no inline scripts are used anywhere in the app.
document.addEventListener('submit', function (event) {
  var form = event.target;
  if (form.classList && form.classList.contains('js-confirm')) {
    var message = form.getAttribute('data-confirm') || 'Are you sure?';
    if (!window.confirm(message)) {
      event.preventDefault();
    }
  }
});
