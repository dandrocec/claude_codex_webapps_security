const questions = document.querySelector('#questions');
const addQuestion = document.querySelector('#addQuestion');

addQuestion.addEventListener('click', () => {
  const count = questions.querySelectorAll('.question-editor').length + 1;
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'question-editor';
  fieldset.innerHTML = `
    <legend>Question ${count}</legend>
    <label>
      Prompt
      <textarea name="prompt" rows="2" required></textarea>
    </label>
    <div class="option-grid">
      <label>A <input name="option_a" required></label>
      <label>B <input name="option_b" required></label>
      <label>C <input name="option_c" required></label>
      <label>D <input name="option_d" required></label>
    </div>
    <label>
      Correct answer
      <select name="correct_option" required>
        <option value="">Select</option>
        <option value="A">A</option>
        <option value="B">B</option>
        <option value="C">C</option>
        <option value="D">D</option>
      </select>
    </label>
  `;
  questions.appendChild(fieldset);
});
