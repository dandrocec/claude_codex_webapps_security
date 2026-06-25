(function () {
  const resultsEl = document.querySelector('.results[data-poll-id]');
  if (!resultsEl) return;

  const pollId = resultsEl.dataset.pollId;
  const totalEl = document.getElementById('totalVotes');

  async function refreshResults() {
    try {
      const response = await fetch(`/api/polls/${pollId}/results`, {
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) return;
      const data = await response.json();

      totalEl.textContent = `${data.totalVotes} vote${data.totalVotes === 1 ? '' : 's'}`;
      data.options.forEach((option) => {
        const row = document.querySelector(`[data-option-id="${option.id}"]`);
        if (!row) return;
        row.querySelector('.bar-fill').style.width = `${option.percent}%`;
        row.querySelector('.bar-count').textContent = option.votes;
        row.querySelector('.bar-percent').textContent = `${option.percent}%`;
      });
    } catch (error) {
      // Keep the currently rendered results if the refresh fails.
    }
  }

  window.setInterval(refreshResults, 3000);
})();
