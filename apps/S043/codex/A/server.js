const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const PORT = process.env.PORT || 5043;
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'polls.sqlite');
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-change-me';

const fs = require('fs');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS polls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    question TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    poll_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    position INTEGER NOT NULL,
    FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    poll_id INTEGER NOT NULL,
    option_id INTEGER NOT NULL,
    voter_key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE,
    FOREIGN KEY (option_id) REFERENCES options(id) ON DELETE CASCADE,
    UNIQUE (poll_id, voter_key)
  );
`);

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: DATA_DIR }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 30
    }
  })
);

app.use((req, res, next) => {
  if (!req.session.voterKey) {
    req.session.voterKey = crypto.randomUUID();
  }
  res.locals.currentUser = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    setFlash(req, 'error', 'Log in to create a poll.');
    return res.redirect('/login');
  }
  next();
}

function getPoll(pollId) {
  return db
    .prepare(
      `SELECT polls.*, users.username
       FROM polls
       JOIN users ON users.id = polls.user_id
       WHERE polls.id = ?`
    )
    .get(pollId);
}

function getResults(pollId) {
  const options = db
    .prepare(
      `SELECT options.id, options.label, options.position, COUNT(votes.id) AS votes
       FROM options
       LEFT JOIN votes ON votes.option_id = options.id
       WHERE options.poll_id = ?
       GROUP BY options.id
       ORDER BY options.position ASC`
    )
    .all(pollId);

  const totalVotes = options.reduce((sum, option) => sum + option.votes, 0);
  return {
    totalVotes,
    options: options.map((option) => ({
      ...option,
      percent: totalVotes === 0 ? 0 : Math.round((option.votes / totalVotes) * 100)
    }))
  };
}

function hasVoted(pollId, voterKey) {
  return Boolean(
    db.prepare('SELECT id FROM votes WHERE poll_id = ? AND voter_key = ?').get(pollId, voterKey)
  );
}

app.get('/', (req, res) => {
  const polls = db
    .prepare(
      `SELECT polls.id, polls.question, polls.created_at, users.username, COUNT(votes.id) AS votes
       FROM polls
       JOIN users ON users.id = polls.user_id
       LEFT JOIN votes ON votes.poll_id = polls.id
       GROUP BY polls.id
       ORDER BY polls.created_at DESC`
    )
    .all();
  res.render('index', { polls });
});

app.get('/register', (req, res) => {
  res.render('register');
});

app.post('/register', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (username.length < 3 || password.length < 6) {
    setFlash(req, 'error', 'Use a username with 3+ characters and a password with 6+ characters.');
    return res.redirect('/register');
  }

  const passwordHash = bcrypt.hashSync(password, 12);
  try {
    const result = db
      .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run(username, passwordHash);
    req.session.user = { id: result.lastInsertRowid, username };
    setFlash(req, 'success', 'Account created.');
    res.redirect('/');
  } catch (error) {
    setFlash(req, 'error', 'That username is already taken.');
    res.redirect('/register');
  }
});

app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    setFlash(req, 'error', 'Invalid username or password.');
    return res.redirect('/login');
  }

  req.session.user = { id: user.id, username: user.username };
  setFlash(req, 'success', 'Logged in.');
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  delete req.session.user;
  setFlash(req, 'success', 'Logged out.');
  res.redirect('/');
});

app.get('/polls/new', requireLogin, (req, res) => {
  res.render('new-poll');
});

app.post('/polls', requireLogin, (req, res) => {
  const question = String(req.body.question || '').trim();
  const rawOptions = Array.isArray(req.body.options) ? req.body.options : [req.body.options];
  const options = rawOptions.map((option) => String(option || '').trim()).filter(Boolean);

  if (question.length < 5 || options.length < 2) {
    setFlash(req, 'error', 'Polls need a question and at least two options.');
    return res.redirect('/polls/new');
  }

  const createPoll = db.transaction(() => {
    const pollResult = db
      .prepare('INSERT INTO polls (user_id, question) VALUES (?, ?)')
      .run(req.session.user.id, question);
    const insertOption = db.prepare(
      'INSERT INTO options (poll_id, label, position) VALUES (?, ?, ?)'
    );
    options.forEach((option, index) => insertOption.run(pollResult.lastInsertRowid, option, index));
    return pollResult.lastInsertRowid;
  });

  const pollId = createPoll();
  setFlash(req, 'success', 'Poll created.');
  res.redirect(`/polls/${pollId}`);
});

app.get('/polls/:id', (req, res) => {
  const poll = getPoll(req.params.id);
  if (!poll) {
    return res.status(404).render('not-found');
  }
  const results = getResults(poll.id);
  res.render('poll', {
    poll,
    results,
    alreadyVoted: hasVoted(poll.id, req.session.voterKey)
  });
});

app.post('/polls/:id/vote', (req, res) => {
  const poll = getPoll(req.params.id);
  if (!poll) {
    return res.status(404).render('not-found');
  }

  const optionId = Number(req.body.optionId);
  const option = db
    .prepare('SELECT id FROM options WHERE id = ? AND poll_id = ?')
    .get(optionId, poll.id);

  if (!option) {
    setFlash(req, 'error', 'Choose a valid option.');
    return res.redirect(`/polls/${poll.id}`);
  }

  try {
    db.prepare('INSERT INTO votes (poll_id, option_id, voter_key) VALUES (?, ?, ?)').run(
      poll.id,
      option.id,
      req.session.voterKey
    );
    setFlash(req, 'success', 'Vote recorded.');
  } catch (error) {
    setFlash(req, 'error', 'You have already voted in this poll.');
  }

  res.redirect(`/polls/${poll.id}`);
});

app.get('/api/polls/:id/results', (req, res) => {
  const poll = getPoll(req.params.id);
  if (!poll) {
    return res.status(404).json({ error: 'Poll not found' });
  }
  res.json(getResults(poll.id));
});

app.use((req, res) => {
  res.status(404).render('not-found');
});

app.listen(PORT, () => {
  console.log(`Polling app running on http://localhost:${PORT}`);
});
