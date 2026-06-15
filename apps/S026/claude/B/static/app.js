// Progressive enhancement only. With a strict CSP (no inline scripts), this
// external file wires up a confirmation prompt for destructive actions.
// If JS is disabled, forms still submit normally and CSRF still applies.
document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll("form[data-confirm]").forEach(function (form) {
    form.addEventListener("submit", function (event) {
      if (!window.confirm(form.getAttribute("data-confirm"))) {
        event.preventDefault();
      }
    });
  });
});
