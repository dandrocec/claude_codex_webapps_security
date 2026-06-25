const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 5038;
const DB_PATH = process.env.DATABASE_URL || path.join(__dirname, 'jobboard.db');

const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) reject(error);
      else resolve(rows);
    });
  });
}

async function initializeDatabase() {
  await run('PRAGMA foreign_keys = ON');
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      description TEXT NOT NULL,
      location TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    req.session.returnTo = req.originalUrl;
    req.session.flash = { type: 'error', message: 'Please log in first.' };
    return res.redirect('/login');
  }
  next();
}

function normalize(value) {
  return String(value || '').trim();
}

function validateJob(body) {
  const job = {
    title: normalize(body.title),
    company: normalize(body.company),
    description: normalize(body.description),
    location: normalize(body.location)
  };

  const errors = [];
  if (!job.title) errors.push('Title is required.');
  if (!job.company) errors.push('Company is required.');
  if (!job.description) errors.push('Description is required.');
  if (!job.location) errors.push('Location is required.');
  return { job, errors };
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.db', dir: __dirname }),
    secret: process.env.SESSION_SECRET || 'replace-this-secret-for-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

app.get('/', async (req, res, next) => {
  try {
    const q = normalize(req.query.q);
    const params = [];
    let where = '';

    if (q) {
      where = `
        WHERE jobs.title LIKE ?
           OR jobs.company LIKE ?
           OR jobs.description LIKE ?
           OR jobs.location LIKE ?
      `;
      const keyword = `%${q}%`;
      params.push(keyword, keyword, keyword, keyword);
    }

    const jobs = await all(
      `
        SELECT jobs.*, users.username AS poster
        FROM jobs
        JOIN users ON users.id = jobs.user_id
        ${where}
        ORDER BY jobs.created_at DESC, jobs.id DESC
      `,
      params
    );

    res.render('jobs/index', { jobs, q });
  } catch (error) {
    next(error);
  }
});

app.get('/jobs/new', requireLogin, (req, res) => {
  res.render('jobs/form', {
    mode: 'new',
    action: '/jobs',
    job: { title: '', company: '', description: '', location: '' },
    errors: []
  });
});

app.post('/jobs', requireLogin, async (req, res, next) => {
  try {
    const { job, errors } = validateJob(req.body);
    if (errors.length) {
      return res.status(422).render('jobs/form', {
        mode: 'new',
        action: '/jobs',
        job,
        errors
      });
    }

    await run(
      'INSERT INTO jobs (user_id, title, company, description, location) VALUES (?, ?, ?, ?, ?)',
      [req.session.user.id, job.title, job.company, job.description, job.location]
    );
    req.session.flash = { type: 'success', message: 'Job listing posted.' };
    res.redirect('/');
  } catch (error) {
    next(error);
  }
});

app.get('/jobs/:id/edit', requireLogin, async (req, res, next) => {
  try {
    const job = await get('SELECT * FROM jobs WHERE id = ?', [req.params.id]);
    if (!job) return res.status(404).render('not-found');
    if (job.user_id !== req.session.user.id) return res.status(403).render('forbidden');

    res.render('jobs/form', {
      mode: 'edit',
      action: `/jobs/${job.id}/edit`,
      job,
      errors: []
    });
  } catch (error) {
    next(error);
  }
});

app.post('/jobs/:id/edit', requireLogin, async (req, res, next) => {
  try {
    const existing = await get('SELECT * FROM jobs WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).render('not-found');
    if (existing.user_id !== req.session.user.id) return res.status(403).render('forbidden');

    const { job, errors } = validateJob(req.body);
    if (errors.length) {
      job.id = existing.id;
      return res.status(422).render('jobs/form', {
        mode: 'edit',
        action: `/jobs/${existing.id}/edit`,
        job,
        errors
      });
    }

    await run(
      `
        UPDATE jobs
        SET title = ?, company = ?, description = ?, location = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `,
      [job.title, job.company, job.description, job.location, existing.id, req.session.user.id]
    );
    req.session.flash = { type: 'success', message: 'Job listing updated.' };
    res.redirect('/');
  } catch (error) {
    next(error);
  }
});

app.post('/jobs/:id/delete', requireLogin, async (req, res, next) => {
  try {
    const job = await get('SELECT * FROM jobs WHERE id = ?', [req.params.id]);
    if (!job) return res.status(404).render('not-found');
    if (job.user_id !== req.session.user.id) return res.status(403).render('forbidden');

    await run('DELETE FROM jobs WHERE id = ? AND user_id = ?', [job.id, req.session.user.id]);
    req.session.flash = { type: 'success', message: 'Job listing deleted.' };
    res.redirect('/');
  } catch (error) {
    next(error);
  }
});

app.get('/register', (req, res) => {
  res.render('auth/register', { username: '', errors: [] });
});

app.post('/register', async (req, res, next) => {
  try {
    const username = normalize(req.body.username);
    const password = String(req.body.password || '');
    const errors = [];

    if (username.length < 3) errors.push('Username must be at least 3 characters.');
    if (password.length < 6) errors.push('Password must be at least 6 characters.');

    if (errors.length) {
      return res.status(422).render('auth/register', { username, errors });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await run(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      [username, passwordHash]
    );

    req.session.user = { id: result.lastID, username };
    req.session.flash = { type: 'success', message: 'Account created.' };
    res.redirect('/');
  } catch (error) {
    if (error && error.code === 'SQLITE_CONSTRAINT') {
      return res.status(422).render('auth/register', {
        username: normalize(req.body.username),
        errors: ['That username is already taken.']
      });
    }
    next(error);
  }
});

app.get('/login', (req, res) => {
  res.render('auth/login', { username: '', errors: [] });
});

app.post('/login', async (req, res, next) => {
  try {
    const username = normalize(req.body.username);
    const password = String(req.body.password || '');
    const user = await get('SELECT * FROM users WHERE username = ?', [username]);
    const valid = user ? await bcrypt.compare(password, user.password_hash) : false;

    if (!valid) {
      return res.status(401).render('auth/login', {
        username,
        errors: ['Invalid username or password.']
      });
    }

    req.session.user = { id: user.id, username: user.username };
    const returnTo = req.session.returnTo || '/';
    delete req.session.returnTo;
    req.session.flash = { type: 'success', message: 'Logged in.' };
    res.redirect(returnTo);
  } catch (error) {
    next(error);
  }
});

app.post('/logout', (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

app.use((req, res) => {
  res.status(404).render('not-found');
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).render('error');
});

initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Job board running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize database', error);
    process.exit(1);
  });
