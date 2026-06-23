'use strict';

// Progressive-enhancement script for the "create quiz" form.
// Loaded from same-origin per the Content-Security-Policy (no inline JS).

(function () {
  const questionsEl = document.getElementById('questions');
  const addQuestionBtn = document.getElementById('add-question');
  const questionTpl = document.getElementById('question-template');
  const optionTpl = document.getElementById('option-template');

  if (!questionsEl || !addQuestionBtn) return;

  // Rewrite all name="" and radio value="" attributes so the array indices
  // stay contiguous and the "correct" radio value matches the option order
  // that the server will receive.
  function reindex() {
    const blocks = questionsEl.querySelectorAll('.question-block');
    blocks.forEach((block, qIdx) => {
      block.querySelector('legend').textContent = 'Question ' + (qIdx + 1);

      const textInput = block.querySelector('input[type="text"][name*="[text]"]');
      if (textInput) textInput.name = `questions[${qIdx}][text]`;

      const rows = block.querySelectorAll('.option-row');
      rows.forEach((row, oIdx) => {
        const radio = row.querySelector('input[type="radio"]');
        const text = row.querySelector('input[type="text"]');
        radio.name = `questions[${qIdx}][correct]`;
        radio.value = String(oIdx);
        text.name = `questions[${qIdx}][options][]`;
      });
    });
  }

  function addOption(optionsContainer) {
    const node = optionTpl.content.firstElementChild.cloneNode(true);
    optionsContainer.appendChild(node);
    reindex();
  }

  function addQuestion() {
    const node = questionTpl.content.firstElementChild.cloneNode(true);
    questionsEl.appendChild(node);

    const optionsContainer = node.querySelector('.options');
    // Start each new question with two option rows.
    addOption(optionsContainer);
    addOption(optionsContainer);

    node.querySelector('.add-option').addEventListener('click', () => addOption(optionsContainer));
    node.querySelector('.remove-question').addEventListener('click', () => {
      node.remove();
      reindex();
    });

    reindex();
  }

  addQuestionBtn.addEventListener('click', addQuestion);

  // Begin with one question for convenience.
  addQuestion();
})();
