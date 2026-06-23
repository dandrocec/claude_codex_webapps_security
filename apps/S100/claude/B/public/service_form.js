'use strict';

// Add/remove deployment step rows. No innerHTML from user data.
(function () {
  var list = document.getElementById('steps-list');
  var addBtn = document.getElementById('add-step');
  var tpl = document.getElementById('step-template');
  if (!list || !addBtn || !tpl) return;

  addBtn.addEventListener('click', function () {
    var node = tpl.content.cloneNode(true);
    list.appendChild(node);
  });

  list.addEventListener('click', function (e) {
    if (e.target && e.target.classList.contains('remove-step')) {
      var row = e.target.closest('.step-row');
      if (row && list.children.length > 1) {
        row.remove();
      } else if (row) {
        // Keep at least one empty row.
        row.querySelectorAll('input').forEach(function (i) {
          i.value = '';
        });
      }
    }
  });
})();
