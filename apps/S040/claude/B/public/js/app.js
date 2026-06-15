// Progressive enhancement only (CSP: script-src 'self', no inline JS).
// Confirms destructive form submissions that opt in via data-confirm="...".
document.addEventListener('submit', function (event) {
    var form = event.target;
    if (form instanceof HTMLFormElement && form.dataset.confirm) {
        if (!window.confirm(form.dataset.confirm)) {
            event.preventDefault();
        }
    }
});
