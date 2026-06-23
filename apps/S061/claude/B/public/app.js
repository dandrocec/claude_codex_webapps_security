// Progressive enhancement: confirm before submitting destructive forms.
// Kept in an external file so the Content-Security-Policy can forbid inline
// scripts (script-src 'self').
document.addEventListener('submit', function (event) {
  var form = event.target;
  var message = form.getAttribute('data-confirm');
  if (message && !window.confirm(message)) {
    event.preventDefault();
  }
});
