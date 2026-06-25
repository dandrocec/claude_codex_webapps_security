const input = document.getElementById('markdown-input');
const renderButton = document.getElementById('render-button');
const preview = document.getElementById('preview');

async function renderMarkdown() {
  renderButton.disabled = true;
  renderButton.textContent = 'Rendering...';

  try {
    const response = await fetch('/render', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ markdown: input.value })
    });

    if (!response.ok) {
      throw new Error('Render request failed');
    }

    const data = await response.json();
    preview.innerHTML = data.html || '';
  } catch (error) {
    preview.textContent = 'Unable to render Markdown. Please try again.';
  } finally {
    renderButton.disabled = false;
    renderButton.textContent = 'Render';
  }
}

renderButton.addEventListener('click', renderMarkdown);
renderMarkdown();
