document.addEventListener("DOMContentLoaded", () => {
  const logBox = document.querySelector("[data-log-stream]");
  if (!logBox) return;

  const source = new EventSource(logBox.dataset.logStream);
  source.onmessage = (event) => {
    const item = JSON.parse(event.data);
    if (item.content) {
      const row = document.createElement("div");
      row.className = `log-line ${item.stream || "system"}`;
      row.textContent = `[${item.stream || "system"}] ${item.content}`;
      logBox.appendChild(row);
      logBox.scrollTop = logBox.scrollHeight;
    }
    if (item.status === "success" || item.status === "failed") {
      source.close();
      const badge = document.querySelector("[data-status]");
      if (badge) {
        badge.textContent = item.status;
        badge.className = `badge ${item.status}`;
      }
    }
  };
});
