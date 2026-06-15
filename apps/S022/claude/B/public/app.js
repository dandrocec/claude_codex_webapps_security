'use strict';

(function () {
  const form = document.getElementById('calc-form');
  const input = document.getElementById('expression');
  const output = document.getElementById('output');
  const csrfToken = document
    .querySelector('meta[name="csrf-token"]')
    .getAttribute('content');

  function show(message, isError) {
    // Use textContent (never innerHTML) so any value is rendered as text,
    // not parsed as HTML -> no DOM-based XSS.
    output.textContent = message;
    output.classList.toggle('error', Boolean(isError));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const expression = input.value;
    show('Calculating…', false);

    try {
      const res = await fetch('/calc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ expression }),
      });

      const data = await res.json();
      if (!res.ok) {
        show(data.error || 'Request failed', true);
        return;
      }
      show(`= ${data.result}`, false);
    } catch (err) {
      show('Network error', true);
    }
  });
})();
