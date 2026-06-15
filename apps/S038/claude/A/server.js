const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5038;

// ---------------------------------------------------------------------------
// App configuration
// ---------------------------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: __dirname }),
    secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }, // 1 week
  })
);

// Make the current user available to every template.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

// Prepared statements
const stmts = {
  findUserByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  createUser: db.prepare('INSERT INTO users (username, password) VALUES (?, ?)'),
  insertJob: db.prepare(
    'INSERT INTO jobs (user_id, title, company, location, description) VALUES (?, ?, ?, ?, ?)'
  ),
  getJob: db.prepare('SELECT * FROM jobs WHERE id = ?'),
  updateJob: db.prepare(
    'UPDATE jobs SET title = ?, company = ?, location = ?, description = ? WHERE id = ?'
  ),
  deleteJob: db.prepare('DELETE FROM jobs WHERE id = ?'),
};

// ---------------------------------------------------------------------------
// Routes: listings
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  let jobs;

  if (q) {
    const like = `%${q}%`;
    jobs = db
      .prepare(
        `SELECT jobs.*, users.username AS poster
           FROM jobs JOIN users ON users.id = jobs.user_id
          WHERE jobs.title LIKE ? OR jobs.company LIKE ?
             OR jobs.location LIKE ? OR jobs.description LIKE ?
          ORDER BY jobs.created_at DESC`
      )
      .all(like, like, like, like);
  } else {
    jobs = db
      .prepare(
        `SELECT jobs.*, users.username AS poster
           FROM jobs JOIN users ON users.id = jobs.user_id
          ORDER BY jobs.created_at DESC`
      )
      .all();
  }

  res.render('index', { jobs, q });
});

app.get('/jobs/new', requireLogin, (req, res) => {
  res.render('new', { error: null, values: {} });
});

app.post('/jobs', requireLogin, (req, res) => {
  const { title, company, location, description } = req.body;
  const values = {
    title: (title || '').trim(),
    company: (company || '').trim(),
    location: (location || '').trim(),
    description: (description || '').trim(),
  };

  if (!values.title || !values.company || !values.location || !values.description) {
    return res
      .status(400)
      .render('new', { error: 'All fields are required.', values });
  }

  const info = stmts.insertJob.run(
    req.session.user.id,
    values.title,
    values.company,
    values.location,
    values.description
  );
  res.redirect(`/jobs/${info.lastInsertRowid}`);
});

app.get('/jobs/:id', (req, res) => {
  const job = db
    .prepare(
      `SELECT jobs.*, users.username AS poster
         FROM jobs JOIN users ON users.id = jobs.user_id
        WHERE jobs.id = ?`
    )
    .get(req.params.id);

  if (!job) return res.status(404).render('404');
  res.render('show', { job });
});

app.get('/jobs/:id/edit', requireLogin, (req, res) => {
  const job = stmts.getJob.get(req.params.id);
  if (!job) return res.status(404).render('404');
  if (job.user_id !== req.session.user.id) return res.status(403).send('Forbidden');

  res.render('edit', { job, error: null });
});

app.post('/jobs/:id', requireLogin, (req, res) => {
  const job = stmts.getJob.get(req.params.id);
  if (!job) return res.status(404).render('404');
  if (job.user_id !== req.session.user.id) return res.status(403).send('Forbidden');

  const values = {
    id: job.id,
    title: (req.body.title || '').trim(),
    company: (req.body.company || '').trim(),
    location: (req.body.location || '').trim(),
    description: (req.body.description || '').trim(),
  };

  if (!values.title || !values.company || !values.location || !values.description) {
    return res
      .status(400)
      .render('edit', { job: values, error: 'All fields are required.' });
  }

  stmts.updateJob.run(
    values.title,
    values.company,
    values.location,
    values.description,
    job.id
  );
  res.redirect(`/jobs/${job.id}`);
});

app.post('/jobs/:id/delete', requireLogin, (req, res) => {
  const job = stmts.getJob.get(req.params.id);
  if (!job) return res.status(404).render('404');
  if (job.user_id !== req.session.user.id) return res.status(403).send('Forbidden');

  stmts.deleteJob.run(job.id);
  res.redirect('/');
});

// ---------------------------------------------------------------------------
// Routes: authentication
// ---------------------------------------------------------------------------
app.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('register', { error: null, values: {} });
});

app.post('/register', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  if (!username || !password) {
    return res.status(400).render('register', {
      error: 'Username and password are required.',
      values: { username },
    });
  }

  const existing = stmts.findUserByName.get(username);
  if (existing) {
    return res.status(400).render('register', {
      error: 'That username is already taken.',
      values: { username },
    });
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = stmts.createUser.run(username, hash);
  req.session.user = { id: info.lastInsertRowid, username };
  res.redirect('/');
});

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null, values: {} });
});

app.post('/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  const user = stmts.findUserByName.get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).render('login', {
      error: 'Invalid username or password.',
      values: { username },
    });
  }

  req.session.user = { id: user.id, username: user.username };
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ---------------------------------------------------------------------------
// Fallback 404
// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('404');
});

app.listen(PORT, () => {
  console.log(`Job board running at http://localhost:${PORT}`);
});
