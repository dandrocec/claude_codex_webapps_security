(function () {
  const section = document.querySelector("[data-poll-id]");
  if (!section) return;

  const pollId = section.getAttribute("data-poll-id");
  const totalNode = section.querySelector("[data-total]");

  section.querySelectorAll("[data-fill]").forEach((fill) => {
    fill.style.width = `${fill.getAttribute("data-percent") || "0"}%`;
  });

  async function refresh() {
    const response = await fetch(`/polls/${encodeURIComponent(pollId)}/results.json`, {
      headers: { Accept: "application/json" },
      credentials: "same-origin"
    });
    if (!response.ok) return;
    const data = await response.json();
    totalNode.textContent = String(data.totalVotes);

    data.results.forEach((row) => {
      const item = section.querySelector(`[data-option-id="${CSS.escape(String(row.id))}"]`);
      if (!item) return;
      const votes = item.querySelector("[data-votes]");
      const fill = item.querySelector("[data-fill]");
      const percent = data.totalVotes ? Math.round((row.votes / data.totalVotes) * 100) : 0;
      votes.textContent = String(row.votes);
      fill.style.width = `${percent}%`;
    });
  }

  window.setInterval(() => {
    refresh().catch(() => {});
  }, 3000);
})();
