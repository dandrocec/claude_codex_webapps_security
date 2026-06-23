// Add / remove invoice line-item rows. No external dependencies; loaded from
// 'self' so it complies with the strict Content-Security-Policy.
(function () {
  "use strict";

  var tbody = document.querySelector("#line-items tbody");
  var template = document.getElementById("row-template");
  var addBtn = document.getElementById("add-row");

  if (!tbody || !template || !addBtn) {
    return;
  }

  addBtn.addEventListener("click", function () {
    var clone = template.content.cloneNode(true);
    tbody.appendChild(clone);
  });

  tbody.addEventListener("click", function (event) {
    if (event.target.classList.contains("remove-row")) {
      var row = event.target.closest("tr");
      if (row) {
        row.remove();
      }
      // Keep at least one row so the user always has somewhere to type.
      if (!tbody.querySelector("tr.line-item")) {
        tbody.appendChild(template.content.cloneNode(true));
      }
    }
  });
})();
