function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function layout({ title, user, csrfToken, flash = '', body }) {
  const nav = user
    ? `<nav><a href="/dashboard">Dashboard</a><form method="post" action="/logout"><input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}"><button type="submit">Log out</button></form></nav>`
    : '<nav><a href="/login">Log in</a><a href="/register">Register</a></nav>';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header><h1>Integration Hub</h1>${nav}</header>
  <main>
    ${flash ? `<p class="flash">${escapeHtml(flash)}</p>` : ''}
    ${body}
  </main>
</body>
</html>`;
}

function authPage({ mode, csrfToken, errors = [] }) {
  const isRegister = mode === 'register';
  return `<section class="panel narrow">
    <h2>${isRegister ? 'Create account' : 'Log in'}</h2>
    ${errors.map((error) => `<p class="error">${escapeHtml(error.msg || error)}</p>`).join('')}
    <form method="post" action="/${isRegister ? 'register' : 'login'}">
      <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
      <label>Email <input name="email" type="email" required maxlength="254" autocomplete="email"></label>
      <label>Password <input name="password" type="password" required minlength="12" maxlength="128" autocomplete="${isRegister ? 'new-password' : 'current-password'}"></label>
      <button type="submit">${isRegister ? 'Register' : 'Log in'}</button>
    </form>
  </section>`;
}

function dashboard({ csrfToken, webhooks, actions, events, deliveries, origin }) {
  return `<section class="grid">
    <div class="panel">
      <h2>Inbound webhooks</h2>
      <form method="post" action="/webhooks">
        <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
        <label>Name <input name="name" required maxlength="80"></label>
        <button type="submit">Create webhook</button>
      </form>
      <table><thead><tr><th>Name</th><th>URL</th><th></th></tr></thead><tbody>
        ${webhooks.map((hook) => `<tr><td>${escapeHtml(hook.name)}</td><td><code>${escapeHtml(`${origin}/hook/${hook.token}`)}</code></td><td><form method="post" action="/webhooks/${hook.id}/delete"><input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}"><button type="submit">Delete</button></form></td></tr>`).join('')}
      </tbody></table>
    </div>

    <div class="panel">
      <h2>Outbound actions</h2>
      <form method="post" action="/actions">
        <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
        <label>Name <input name="name" required maxlength="80"></label>
        <label>Webhook
          <select name="webhookId" required>
            ${webhooks.map((hook) => `<option value="${hook.id}">${escapeHtml(hook.name)}</option>`).join('')}
          </select>
        </label>
        <label>Method
          <select name="method"><option>POST</option><option>PUT</option><option>PATCH</option></select>
        </label>
        <label>Target URL <input name="url" type="url" required maxlength="2048" placeholder="https://example.com/endpoint"></label>
        <button type="submit">Create action</button>
      </form>
      <table><thead><tr><th>Name</th><th>Method</th><th>URL</th><th></th></tr></thead><tbody>
        ${actions.map((action) => `<tr><td>${escapeHtml(action.name)}</td><td>${escapeHtml(action.method)}</td><td><code>${escapeHtml(action.url)}</code></td><td><form method="post" action="/actions/${action.id}/delete"><input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}"><button type="submit">Delete</button></form></td></tr>`).join('')}
      </tbody></table>
    </div>
  </section>

  <section class="panel">
    <h2>Recent events</h2>
    <table><thead><tr><th>ID</th><th>Webhook</th><th>Payload</th><th>Created</th></tr></thead><tbody>
      ${events.map((event) => `<tr><td>${event.id}</td><td>${escapeHtml(event.webhook_name)}</td><td><pre>${escapeHtml(event.payload)}</pre></td><td>${escapeHtml(event.created_at)}</td></tr>`).join('')}
    </tbody></table>
  </section>

  <section class="panel">
    <h2>Recent deliveries</h2>
    <table><thead><tr><th>ID</th><th>Action</th><th>Status</th><th>Response</th><th>Created</th><th></th></tr></thead><tbody>
      ${deliveries.map((delivery) => `<tr><td>${delivery.id}</td><td>${escapeHtml(delivery.action_name)}</td><td><span class="${delivery.status === 'success' ? 'ok' : 'bad'}">${escapeHtml(delivery.status)}</span></td><td><pre>${escapeHtml(delivery.error_message || delivery.response_body || '')}</pre></td><td>${escapeHtml(delivery.created_at)}</td><td><form method="post" action="/deliveries/${delivery.id}/retry"><input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}"><button type="submit">Retry</button></form></td></tr>`).join('')}
    </tbody></table>
  </section>`;
}

module.exports = { escapeHtml, layout, authPage, dashboard };
