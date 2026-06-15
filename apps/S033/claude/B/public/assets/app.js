// Progressive enhancement only: confirm destructive actions before submit.
(function () {
    "use strict";
    document.addEventListener("submit", function (event) {
        var form = event.target;
        if (form && form.dataset && form.dataset.confirm) {
            if (!window.confirm(form.dataset.confirm)) {
                event.preventDefault();
            }
        }
    });
})();
