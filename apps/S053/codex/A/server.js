const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);
const PORT = Number(process.env.PORT || 5053);
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'portfolio.db');
const OWNER_USER = process.env.OWNER_USER || 'owner';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || 'changeme';
const OWNER_PASSWORD_HASH = bcrypt.hashSync(OWNER_PASSWORD, 10);
const SESSION_SECRET = process.env.SESSION_SECRET || 'replace-this-local-secret';

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    link TEXT NOT NULL,
    image TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const countProjects = db.prepare('SELECT COUNT(*) AS count FROM projects').get().count;
if (countProjects === 0) {
  const seed = db.prepare(`
    INSERT INTO projects (title, description, link, image)
    VALUES (@title, @description, @link, @image)
  `);
  [
    {
      title: 'Brand Identity System',
      description: 'A flexible visual identity and launch site for an independent design studio.',
      link: 'https://example.com/brand-identity',
      image: 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80'
    },
    {
      title: 'Analytics Dashboard',
      description: 'Operational reporting tools with clean charts, saved views, and fast filtering.',
      link: 'https://example.com/analytics-dashboard',
      image: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=80'
    },
    {
      title: 'Editorial Portfolio',
      description: 'A publication-style portfolio for long-form photography and case studies.',
      link: 'https://example.com/editorial-portfolio',
      image: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80'
    }
  ].forEach((project) => seed.run(project));
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'https:', 'data:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"]
    }
  }
}));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: DATA_DIR }),
  name: 'portfolio.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function layout({ title, body, owner = false, flash = '' }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body>
    <header class="site-header">
      <a class="brand" href="/">Studio Portfolio</a>
      <nav class="nav">
        <a href="/">Work</a>
        ${owner ? '<a href="/owner">Manage</a><form method="post" action="/logout"><button type="submit">Log out</button></form>' : '<a href="/login">Owner login</a>'}
      </nav>
    </header>
    <main>
      ${flash ? `<div class="flash">${escapeHtml(flash)}</div>` : ''}
      ${body}
    </main>
  </body>
</html>`;
}

function projectCard(project, owner = false) {
  return `<article class="project-card">
    <a class="project-image" href="${escapeHtml(project.link)}" target="_blank" rel="noreferrer">
      <img src="${escapeHtml(project.image)}" alt="${escapeHtml(project.title)}">
    </a>
    <div class="project-content">
      <h2>${escapeHtml(project.title)}</h2>
      <p>${escapeHtml(project.description)}</p>
      <a class="text-link" href="${escapeHtml(project.link)}" target="_blank" rel="noreferrer">View project</a>
      ${owner ? `<div class="project-actions">
        <a class="button secondary" href="/owner/projects/${project.id}/edit">Edit</a>
        <form method="post" action="/owner/projects/${project.id}/delete" onsubmit="return confirm('Delete this project?')">
          <button class="danger" type="submit">Delete</button>
        </form>
      </div>` : ''}
    </div>
  </article>`;
}

function requireOwner(req, res, next) {
  if (req.session.owner) return next();
  res.redirect('/login');
}

function validateProject(input) {
  const title = String(input.title || '').trim();
  const description = String(input.description || '').trim();
  const link = normalizeUrl(input.link);
  const image = normalizeUrl(input.image);
  const errors = [];

  if (!title) errors.push('Title is required.');
  if (!description) errors.push('Description is required.');
  if (!link) errors.push('Project link is required.');
  if (!image) errors.push('Image URL is required.');

  return { errors, project: { title, description, link, image } };
}

function projectForm({ action, project = {}, heading, buttonText, errors = [] }) {
  return `<section class="panel narrow">
    <h1>${escapeHtml(heading)}</h1>
    ${errors.length ? `<ul class="errors">${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul>` : ''}
    <form class="stacked-form" method="post" action="${escapeHtml(action)}">
      <label>
        <span>Title</span>
        <input name="title" value="${escapeHtml(project.title || '')}" required>
      </label>
      <label>
        <span>Description</span>
        <textarea name="description" rows="5" required>${escapeHtml(project.description || '')}</textarea>
      </label>
      <label>
        <span>Project link</span>
        <input name="link" type="url" value="${escapeHtml(project.link || '')}" placeholder="https://example.com" required>
      </label>
      <label>
        <span>Image URL</span>
        <input name="image" type="url" value="${escapeHtml(project.image || '')}" placeholder="https://example.com/image.jpg" required>
      </label>
      <div class="form-actions">
        <button type="submit">${escapeHtml(buttonText)}</button>
        <a class="button secondary" href="/owner">Cancel</a>
      </div>
    </form>
  </section>`;
}

app.get('/', (req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC, id DESC').all();
  const body = `<section class="hero">
    <p class="eyebrow">Selected work</p>
    <h1>Practical digital projects with crisp presentation.</h1>
    <p>Browse recent portfolio entries, case studies, and product work.</p>
  </section>
  <section class="grid">
    ${projects.length ? projects.map((project) => projectCard(project)).join('') : '<p class="empty">No projects have been published yet.</p>'}
  </section>`;
  res.send(layout({ title: 'Studio Portfolio', body, owner: Boolean(req.session.owner) }));
});

app.get('/login', (req, res) => {
  if (req.session.owner) return res.redirect('/owner');
  const failed = req.query.error === '1';
  const body = `<section class="panel login-panel">
    <h1>Owner login</h1>
    ${failed ? '<p class="error-text">Invalid username or password.</p>' : ''}
    <form class="stacked-form" method="post" action="/login">
      <label>
        <span>Username</span>
        <input name="username" autocomplete="username" required>
      </label>
      <label>
        <span>Password</span>
        <input name="password" type="password" autocomplete="current-password" required>
      </label>
      <button type="submit">Log in</button>
    </form>
  </section>`;
  res.send(layout({ title: 'Owner Login', body }));
});

app.post('/login', (req, res) => {
  const usernameOk = String(req.body.username || '') === OWNER_USER;
  const passwordOk = bcrypt.compareSync(String(req.body.password || ''), OWNER_PASSWORD_HASH);

  if (!usernameOk || !passwordOk) {
    return res.redirect('/login?error=1');
  }

  req.session.owner = true;
  res.redirect('/owner');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/owner', requireOwner, (req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC, id DESC').all();
  const body = `<section class="owner-header">
    <div>
      <p class="eyebrow">Owner dashboard</p>
      <h1>Manage projects</h1>
    </div>
    <a class="button" href="/owner/projects/new">Add project</a>
  </section>
  <section class="grid owner-grid">
    ${projects.length ? projects.map((project) => projectCard(project, true)).join('') : '<p class="empty">Create your first project to publish it on the public grid.</p>'}
  </section>`;
  res.send(layout({ title: 'Manage Projects', body, owner: true }));
});

app.get('/owner/projects/new', requireOwner, (req, res) => {
  const body = projectForm({
    action: '/owner/projects',
    heading: 'Add project',
    buttonText: 'Create project'
  });
  res.send(layout({ title: 'Add Project', body, owner: true }));
});

app.post('/owner/projects', requireOwner, (req, res) => {
  const { errors, project } = validateProject(req.body);
  if (errors.length) {
    const body = projectForm({
      action: '/owner/projects',
      heading: 'Add project',
      buttonText: 'Create project',
      project,
      errors
    });
    return res.status(422).send(layout({ title: 'Add Project', body, owner: true }));
  }

  db.prepare(`
    INSERT INTO projects (title, description, link, image)
    VALUES (@title, @description, @link, @image)
  `).run(project);
  res.redirect('/owner');
});

app.get('/owner/projects/:id/edit', requireOwner, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).send(layout({ title: 'Not Found', body: '<p class="empty">Project not found.</p>', owner: true }));

  const body = projectForm({
    action: `/owner/projects/${project.id}`,
    heading: 'Edit project',
    buttonText: 'Save changes',
    project
  });
  res.send(layout({ title: 'Edit Project', body, owner: true }));
});

app.post('/owner/projects/:id', requireOwner, (req, res) => {
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).send(layout({ title: 'Not Found', body: '<p class="empty">Project not found.</p>', owner: true }));

  const { errors, project } = validateProject(req.body);
  if (errors.length) {
    const body = projectForm({
      action: `/owner/projects/${existing.id}`,
      heading: 'Edit project',
      buttonText: 'Save changes',
      project: { ...project, id: existing.id },
      errors
    });
    return res.status(422).send(layout({ title: 'Edit Project', body, owner: true }));
  }

  db.prepare(`
    UPDATE projects
    SET title = @title,
        description = @description,
        link = @link,
        image = @image,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({ ...project, id: existing.id });
  res.redirect('/owner');
});

app.post('/owner/projects/:id/delete', requireOwner, (req, res) => {
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.redirect('/owner');
});

app.use((req, res) => {
  res.status(404).send(layout({ title: 'Not Found', body: '<p class="empty">Page not found.</p>', owner: Boolean(req.session.owner) }));
});

app.listen(PORT, () => {
  console.log(`Portfolio site running on http://localhost:${PORT}`);
});
