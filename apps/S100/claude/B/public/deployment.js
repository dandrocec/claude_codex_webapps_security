'use strict';

// Live-stream deployment logs via Server-Sent Events.
// All log text is inserted with textContent (never innerHTML) so log output
// can never inject markup/script into the page.
(function () {
  var log = document.getElementById('log');
  if (!log) return;

  var live = log.getAttribute('data-live') === 'true';
  if (!live) return; // finished deployments are already fully rendered

  var url = log.getAttribute('data-stream-url');
  var statusEl = document.getElementById('status');
  var indicator = document.getElementById('live-indicator');

  // The server replays prior lines on connect, so clear the static render
  // to avoid duplicates.
  log.textContent = '';

  var es = new EventSource(url);

  es.addEventListener('log', function (ev) {
    try {
      var entry = JSON.parse(ev.data);
      appendLine(entry.stream, entry.line);
    } catch (e) {
      /* ignore malformed */
    }
  });

  es.addEventListener('done', function (ev) {
    try {
      var info = JSON.parse(ev.data);
      if (statusEl) {
        statusEl.textContent = info.status;
        statusEl.className = 'status status-' + info.status;
      }
    } catch (e) {
      /* ignore */
    }
    if (indicator) indicator.remove();
    es.close();
  });

  es.onerror = function () {
    // Connection dropped/closed; stop the live indicator.
    if (indicator) indicator.textContent = '● disconnected';
  };

  function appendLine(stream, text) {
    var span = document.createElement('span');
    span.className = 'log-line log-' + (stream || 'stdout');
    span.textContent = text;
    log.appendChild(span);
    log.appendChild(document.createTextNode('\n'));
    log.scrollTop = log.scrollHeight;
  }
})();
