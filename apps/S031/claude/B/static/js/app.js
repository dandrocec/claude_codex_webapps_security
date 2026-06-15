// Progressive enhancement: confirm before submitting any form marked with
// data-confirm. Loaded as an external script so the Content-Security-Policy
// can stay strict (no 'unsafe-inline').
document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll("form[data-confirm]").forEach(function (form) {
    form.addEventListener("submit", function (event) {
      if (!window.confirm(form.getAttribute("data-confirm"))) {
        event.preventDefault();
      }
    });
  });
});
