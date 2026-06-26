(function () {
  const log = document.getElementById("log");
  const status = document.getElementById("status");

  function append(entry) {
    const line = `[${entry.created_at}] ${entry.stream}: ${entry.line}`;
    log.textContent = log.textContent ? `${log.textContent}\n${line}` : line;
    log.scrollTop = log.scrollHeight;
  }

  if (!["queued", "running"].includes(window.DEPLOYMENT_STATUS)) return;

  const source = new EventSource(`/deployments/${window.DEPLOYMENT_ID}/stream`);
  source.addEventListener("log", event => append(JSON.parse(event.data)));
  source.addEventListener("done", event => {
    const data = JSON.parse(event.data);
    status.textContent = data.status;
    status.className = `status ${data.status}`;
    source.close();
  });
})();
