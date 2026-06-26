require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const csrf = require('csurf');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const sanitizeHtml = require('sanitize-html');
const validator = require('validator');
const { db, bootstrapOwner } = require('./db');

const app = express();
const port = Number.parseInt(process.env.PORT || '5053', 10);
const isProduction = process.env.NODE_ENV === 'production';
const secureCookies = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === 'true'
  : isProduction;

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be set to at least 32 characters.');
}

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'https:', 'data:'],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(express.static(path.join(__dirname, '..', 'public'), {
  immutable: true,
  maxAge: '1h'
}));
app.use(express.urlencoded({ extended: false, limit: '25kb' }));
app.use(session({
  name: 'portfolio.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 4
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
});

app.use(csrf());
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  res.locals.currentUser = req.session.user || null;
  next();
});

function stripText(value, maxLength) {
  return sanitizeHtml(String(value || ''), {
    allowedTags: [],
    allowedAttributes: {}
  }).trim().slice(0, maxLength);
}

function cleanUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (!validator.isURL(trimmed, {
    protocols: ['http', 'https'],
    require_protocol: true,
    require_valid_protocol: true,
    allow_underscores: false
  })) {
    return null;
  }
  const parsed = new URL(trimmed);
  return parsed.toString().slice(0, 2048);
}

function validateProject(body) {
  const project = {
    title: stripText(body.title, 120),
    description: stripText(body.description, 2000),
    link: cleanUrl(body.link),
    image: cleanUrl(body.image)
  };
  const errors = [];

  if (!project.title) errors.push('Title is required.');
  if (!project.description) errors.push('Description is required.');
  if (project.link === null) errors.push('Project link must be a valid http or https URL.');
  if (project.image === null) errors.push('Image URL must be a valid http or https URL.');

  if (project.link === null) project.link = '';
  if (project.image === null) project.image = '';
  return { project, errors };
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  return next();
}

function getOwnerProject(req, res, next) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) return res.status(404).render('404');

  const project = db.prepare(`
    SELECT id, title, description, link, image
    FROM projects
    WHERE id = ? AND owner_id = ?
  `).get(id, req.session.user.id);

  if (!project) return res.status(404).render('404');
  res.locals.project = project;
  return next();
}

app.get('/', (req, res) => {
  const projects = db.prepare(`
    SELECT id, title, description, link, image
    FROM projects
    ORDER BY created_at DESC, id DESC
  `).all();
  res.render('public', { projects });
});

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  return res.render('login', { error: null, email: '' });
});

app.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const email = stripText(req.body.email, 254).toLowerCase();
    const password = String(req.body.password || '');
    const user = db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?').get(email);
    const valid = user ? await bcrypt.compare(password, user.password_hash) : false;

    if (!valid) {
      return res.status(401).render('login', {
        error: 'Invalid email or password.',
        email
      });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: user.id, email: user.email };
      return res.redirect('/dashboard');
    });
  } catch (error) {
    next(error);
  }
});

app.post('/logout', requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('portfolio.sid');
    return res.redirect('/');
  });
});

app.get('/dashboard', requireAuth, (req, res) => {
  const projects = db.prepare(`
    SELECT id, title, description, link, image
    FROM projects
    WHERE owner_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(req.session.user.id);
  res.render('dashboard', { projects });
});

app.get('/projects/new', requireAuth, (req, res) => {
  res.render('project-form', {
    heading: 'New project',
    action: '/projects',
    project: { title: '', description: '', link: '', image: '' },
    errors: []
  });
});

app.post('/projects', requireAuth, (req, res) => {
  const { project, errors } = validateProject(req.body);
  if (errors.length) {
    return res.status(400).render('project-form', {
      heading: 'New project',
      action: '/projects',
      project,
      errors
    });
  }

  db.prepare(`
    INSERT INTO projects (owner_id, title, description, link, image)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.session.user.id, project.title, project.description, project.link, project.image);
  return res.redirect('/dashboard');
});

app.get('/projects/:id/edit', requireAuth, getOwnerProject, (req, res) => {
  res.render('project-form', {
    heading: 'Edit project',
    action: `/projects/${res.locals.project.id}`,
    project: res.locals.project,
    errors: []
  });
});

app.post('/projects/:id', requireAuth, getOwnerProject, (req, res) => {
  const { project, errors } = validateProject(req.body);
  const action = `/projects/${res.locals.project.id}`;

  if (errors.length) {
    return res.status(400).render('project-form', {
      heading: 'Edit project',
      action,
      project: { id: res.locals.project.id, ...project },
      errors
    });
  }

  db.prepare(`
    UPDATE projects
    SET title = ?, description = ?, link = ?, image = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND owner_id = ?
  `).run(project.title, project.description, project.link, project.image, res.locals.project.id, req.session.user.id);
  return res.redirect('/dashboard');
});

app.post('/projects/:id/delete', requireAuth, getOwnerProject, (req, res) => {
  db.prepare('DELETE FROM projects WHERE id = ? AND owner_id = ?')
    .run(res.locals.project.id, req.session.user.id);
  res.redirect('/dashboard');
});

app.use((req, res) => {
  res.status(404).render('404');
});

app.use((err, req, res, next) => {
  res.locals.currentUser = req.session ? req.session.user || null : null;
  try {
    res.locals.csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : '';
  } catch {
    res.locals.csrfToken = '';
  }

  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('error', { message: 'Your session expired. Please retry the action.' });
  }

  console.error(err);
  return res.status(500).render('error', { message: 'Something went wrong.' });
});

bootstrapOwner()
  .then(() => {
    app.listen(port, () => {
      console.log(`Portfolio app listening on port ${port}`);
    });
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
