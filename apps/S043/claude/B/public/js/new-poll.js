'use strict';

// Lets the user add more option inputs (up to 10) on the create-poll form.
(function () {
  var addBtn = document.getElementById('add-option');
  var fieldset = document.getElementById('options');
  if (!addBtn || !fieldset) return;

  var MAX = 10;

  addBtn.addEventListener('click', function () {
    var current = fieldset.querySelectorAll('.option-input').length;
    if (current >= MAX) {
      addBtn.disabled = true;
      return;
    }
    var input = document.createElement('input');
    input.type = 'text';
    input.name = 'options';
    input.className = 'option-input';
    input.maxLength = 200;
    input.placeholder = 'Option';
    fieldset.appendChild(input);

    if (current + 1 >= MAX) addBtn.disabled = true;
  });
})();
