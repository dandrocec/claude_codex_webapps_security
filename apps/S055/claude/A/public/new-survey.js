(function () {
  const list = document.getElementById('questions');
  const tpl = document.getElementById('question-template');
  const addBtn = document.getElementById('add-question');

  function renumber() {
    list.querySelectorAll('.question-row').forEach((row, i) => {
      row.querySelector('.q-num').textContent = 'Question ' + (i + 1);
    });
  }

  function wire(row) {
    const typeSel = row.querySelector('select[name="q_type"]');
    const optField = row.querySelector('.options-field');
    typeSel.addEventListener('change', () => {
      optField.style.display = typeSel.value === 'choice' ? '' : 'none';
    });
    row.querySelector('.remove-q').addEventListener('click', () => {
      row.remove();
      renumber();
    });
  }

  function addQuestion() {
    const frag = tpl.content.cloneNode(true);
    const row = frag.querySelector('.question-row');
    wire(row);
    list.appendChild(frag);
    renumber();
  }

  addBtn.addEventListener('click', addQuestion);

  // Start with one question.
  addQuestion();
})();
