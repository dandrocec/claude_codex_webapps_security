'use strict';

const questionsEl = document.getElementById('questions');
const questionTpl = document.getElementById('question-template');
const optionTpl = document.getElementById('option-template');
const errorsEl = document.getElementById('form-errors');

let questionCounter = 0; // used to give radio groups unique names

function renumberQuestions() {
  questionsEl.querySelectorAll('.question').forEach((q, i) => {
    q.querySelector('.q-index').textContent = i + 1;
  });
}

function addOption(optionsEl, groupName) {
  const node = optionTpl.content.cloneNode(true);
  const radio = node.querySelector('.o-correct');
  radio.name = groupName;
  node.querySelector('.remove-option').addEventListener('click', (e) => {
    e.target.closest('.option-row').remove();
  });
  optionsEl.appendChild(node);
}

function addQuestion() {
  const groupName = `correct-${questionCounter++}`;
  const node = questionTpl.content.cloneNode(true);
  const optionsEl = node.querySelector('.options');

  node.querySelector('.remove-question').addEventListener('click', (e) => {
    e.target.closest('.question').remove();
    renumberQuestions();
  });
  node.querySelector('.add-option').addEventListener('click', () => {
    addOption(optionsEl, groupName);
  });

  // Start each new question with two empty options.
  questionsEl.appendChild(node);
  addOption(optionsEl, groupName);
  addOption(optionsEl, groupName);
  renumberQuestions();
}

function collectPayload() {
  const questions = [...questionsEl.querySelectorAll('.question')].map((q) => ({
    text: q.querySelector('.q-text').value.trim(),
    options: [...q.querySelectorAll('.option-row')].map((row) => ({
      text: row.querySelector('.o-text').value.trim(),
      isCorrect: row.querySelector('.o-correct').checked
    }))
  }));

  return {
    title: document.getElementById('quiz-title').value.trim(),
    questions
  };
}

function showErrors(messages) {
  errorsEl.innerHTML = '';
  if (!messages || messages.length === 0) {
    errorsEl.hidden = true;
    return;
  }
  const ul = document.createElement('ul');
  messages.forEach((m) => {
    const li = document.createElement('li');
    li.textContent = m;
    ul.appendChild(li);
  });
  errorsEl.appendChild(ul);
  errorsEl.hidden = false;
}

document.getElementById('add-question').addEventListener('click', addQuestion);

document.getElementById('quiz-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showErrors([]);

  const payload = collectPayload();
  try {
    const res = await fetch('/teacher/quizzes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      showErrors(data.errors || ['Something went wrong.']);
      return;
    }
    window.location.href = `/quiz/${data.id}`;
  } catch (err) {
    showErrors(['Network error — could not save the quiz.']);
  }
});

// Start with one question ready to fill in.
addQuestion();
