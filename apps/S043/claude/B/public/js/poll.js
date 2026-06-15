'use strict';

// Renders the live results bar chart and refreshes it periodically.
(function () {
  var canvas = document.getElementById('results-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  var pollId = canvas.getAttribute('data-poll-id');
  var chart = null;

  function draw(data) {
    var labels = data.options.map(function (o) { return o.label; });
    var counts = data.options.map(function (o) { return o.votes; });

    if (chart) {
      chart.data.labels = labels;
      chart.data.datasets[0].data = counts;
      chart.update();
      return;
    }

    chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{ label: 'Votes', data: counts }],
      },
      options: {
        responsive: true,
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
        plugins: { legend: { display: false } },
      },
    });
  }

  function refresh() {
    fetch('/polls/' + encodeURIComponent(pollId) + '/results.json', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { if (data) draw(data); })
      .catch(function () { /* ignore transient errors */ });
  }

  refresh();
  setInterval(refresh, 4000); // live updates every 4s

  // Confirm before deleting (CSP-safe: no inline handlers).
  var deleteForm = document.getElementById('delete-form');
  if (deleteForm) {
    deleteForm.addEventListener('submit', function (e) {
      if (!window.confirm('Delete this poll and all its votes?')) {
        e.preventDefault();
      }
    });
  }
})();
