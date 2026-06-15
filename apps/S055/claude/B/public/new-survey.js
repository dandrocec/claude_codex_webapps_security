'use strict';

// Adds another question input to the new-survey form.
// Kept in an external file so the Content-Security-Policy can forbid inline JS.
(function () {
  var btn = document.getElementById('add-question');
  var container = document.getElementById('questions');
  if (!btn || !container) return;

  btn.addEventListener('click', function () {
    var input = document.createElement('input');
    input.type = 'text';
    input.name = 'questions[]';
    input.maxLength = 500;
    input.placeholder = 'Question text';
    container.appendChild(input);
    input.focus();
  });
})();
