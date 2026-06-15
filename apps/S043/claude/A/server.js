'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5043;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 1 week
}));

// Make the current user and a flash message available to every template.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.userId
    ? db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.session.userId)
    : null;
  res.locals.error = null;
  next();
});

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

// Stable per-visitor identity used to enforce "one vote per poll".
function voterId(req) {
  if (!req.session.voter) {
    req.session.voter = crypto.randomBytes(16).toString('hex');
  }
  return req.session.voter;
}

// --- Helpers -----------------------------------------------------------------

function getPollWithResults(pollId) {
  const poll = db.prepare(`
    SELECT polls.*, users.username AS author
    FROM polls JOIN users ON users.id = polls.user_id
    WHERE polls.id = ?
  `).get(pollId);
  if (!poll) return null;

  const options = db.prepare(`
    SELECT options.id, options.text, COUNT(votes.id) AS votes
    FROM options
    LEFT JOIN votes ON votes.option_id = options.id
    WHERE options.poll_id = ?
    GROUP BY options.id
    ORDER BY options.id
  `).all(pollId);

  const total = options.reduce((sum, o) => sum + o.votes, 0);
  return { poll, options, total };
}

// --- Auth routes -------------------------------------------------------------

app.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('register');
});

app.post('/register', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  if (username.length < 3 || password.length < 6) {
    return res.status(400).render('register', {
      error: 'Username must be 3+ characters and password 6+ characters.'
    });
  }
  try {
    const hash = bcrypt.hashSync(password, 10);
    const info = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run(username, hash);
    req.session.userId = info.lastInsertRowid;
    res.redirect('/');
  } catch (err) {
    res.status(400).render('register', { error: 'That username is already taken.' });
  }
});

app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login');
});

app.post('/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).render('login', { error: 'Invalid username or password.' });
  }
  req.session.userId = user.id;
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// --- Poll routes -------------------------------------------------------------

app.get('/', (req, res) => {
  const polls = db.prepare(`
    SELECT polls.id, polls.question, polls.created_at, users.username AS author,
           COUNT(votes.id) AS total_votes
    FROM polls
    JOIN users ON users.id = polls.user_id
    LEFT JOIN votes ON votes.poll_id = polls.id
    GROUP BY polls.id
    ORDER BY polls.created_at DESC, polls.id DESC
  `).all();
  res.render('index', { polls });
});

app.get('/polls/new', requireLogin, (req, res) => {
  res.render('new');
});

app.post('/polls', requireLogin, (req, res) => {
  const question = (req.body.question || '').trim();
  // Options arrive as an array (name="options"); keep the non-empty, unique ones.
  let options = [].concat(req.body.options || [])
    .map(o => (o || '').trim())
    .filter(Boolean);
  options = [...new Set(options)];

  if (!question || options.length < 2) {
    return res.status(400).render('new', {
      error: 'Please provide a question and at least two distinct options.'
    });
  }

  const createPoll = db.transaction(() => {
    const info = db.prepare('INSERT INTO polls (user_id, question) VALUES (?, ?)')
      .run(req.session.userId, question);
    const insertOption = db.prepare('INSERT INTO options (poll_id, text) VALUES (?, ?)');
    for (const text of options) insertOption.run(info.lastInsertRowid, text);
    return info.lastInsertRowid;
  });

  const pollId = createPoll();
  res.redirect(`/polls/${pollId}`);
});

app.get('/polls/:id', (req, res) => {
  const data = getPollWithResults(req.params.id);
  if (!data) return res.status(404).render('404');

  const hasVoted = !!db.prepare('SELECT 1 FROM votes WHERE poll_id = ? AND voter = ?')
    .get(req.params.id, voterId(req));

  res.render('poll', { ...data, hasVoted });
});

app.post('/polls/:id/vote', (req, res) => {
  const pollId = Number(req.params.id);
  const optionId = Number(req.body.option_id);

  // The option must belong to this poll.
  const option = db.prepare('SELECT id FROM options WHERE id = ? AND poll_id = ?')
    .get(optionId, pollId);
  if (!option) return res.redirect(`/polls/${pollId}`);

  try {
    db.prepare('INSERT INTO votes (poll_id, option_id, voter) VALUES (?, ?, ?)')
      .run(pollId, optionId, voterId(req));
  } catch (err) {
    // UNIQUE(poll_id, voter) violation -> visitor already voted; ignore.
  }
  res.redirect(`/polls/${pollId}`);
});

// Live results feed consumed by the bar chart.
app.get('/polls/:id/results.json', (req, res) => {
  const data = getPollWithResults(req.params.id);
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.json({
    question: data.poll.question,
    total: data.total,
    options: data.options.map(o => ({ id: o.id, text: o.text, votes: o.votes }))
  });
});

app.use((req, res) => res.status(404).render('404'));

app.listen(PORT, () => {
  console.log(`Polling app running at http://localhost:${PORT}`);
});
