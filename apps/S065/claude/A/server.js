'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const SqliteStore = require('./session-store');

const q = require('./queries');

const app = express();
const PORT = process.env.PORT || 5065;

// --- App setup -----------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new SqliteStore(),
    secret: process.env.SESSION_SECRET || 'change-me-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }, // 1 week
  })
);

// Make the current user available to every view.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.userId
    ? q.findUserById.get(req.session.userId)
    : null;
  res.locals.error = null;
  next();
});

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  next();
}

// --- Auth ----------------------------------------------------------------
app.get('/register', (req, res) => res.render('register'));

app.post('/register', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  if (username.length < 3 || password.length < 4) {
    return res.status(400).render('register', {
      error: 'Username must be 3+ chars and password 4+ chars.',
    });
  }
  if (q.findUserByName.get(username)) {
    return res
      .status(409)
      .render('register', { error: 'That username is taken.' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const info = q.createUser.run(username, hash);
  req.session.userId = info.lastInsertRowid;
  res.redirect('/');
});

app.get('/login', (req, res) => res.render('login'));

app.post('/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const user = q.findUserByName.get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res
      .status(401)
      .render('login', { error: 'Invalid username or password.' });
  }
  req.session.userId = user.id;
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// --- Questions -----------------------------------------------------------
app.get('/', (req, res) => {
  res.render('index', { questions: q.listQuestions.all() });
});

app.get('/questions/new', requireLogin, (req, res) =>
  res.render('new-question')
);

app.post('/questions', requireLogin, (req, res) => {
  const title = (req.body.title || '').trim();
  const body = (req.body.body || '').trim();
  if (!title || !body) {
    return res.status(400).render('new-question', {
      error: 'Both a title and a body are required.',
    });
  }
  const info = q.insertQuestion.run(req.session.userId, title, body);
  res.redirect(`/questions/${info.lastInsertRowid}`);
});

app.get('/questions/:id', (req, res) => {
  const id = Number(req.params.id);
  const question = q.getQuestion.get(id);
  if (!question) return res.status(404).render('404');

  const answers = q.listAnswers.all(id, id);
  const userId = req.session.userId;

  // Attach the current user's vote (if any) to each post for highlighting.
  const myQVote = q.votesForUser(userId, 'question', [id])[id] || 0;
  const myAVotes = q.votesForUser(
    userId,
    'answer',
    answers.map((a) => a.id)
  );

  res.render('question', {
    question,
    answers,
    myQVote,
    myAVotes,
  });
});

// --- Answers -------------------------------------------------------------
app.post('/questions/:id/answers', requireLogin, (req, res) => {
  const id = Number(req.params.id);
  const question = q.getQuestion.get(id);
  if (!question) return res.status(404).render('404');

  const body = (req.body.body || '').trim();
  if (body) {
    q.insertAnswer.run(id, req.session.userId, body);
  }
  res.redirect(`/questions/${id}#answers`);
});

// Accept an answer (only the question's author may do this).
app.post('/answers/:id/accept', requireLogin, (req, res) => {
  const answer = q.getAnswer.get(Number(req.params.id));
  if (!answer) return res.status(404).render('404');

  const question = q.getQuestion.get(answer.question_id);
  if (question.user_id !== req.session.userId) {
    return res.status(403).send('Only the question author can accept an answer.');
  }
  // Toggle: accepting the already-accepted answer clears it.
  const newValue =
    question.accepted_answer_id === answer.id ? null : answer.id;
  q.setAcceptedAnswer.run(newValue, question.id);
  res.redirect(`/questions/${question.id}#answers`);
});

// --- Voting --------------------------------------------------------------
// POST /vote with { post_type, post_id, value }
app.post('/vote', requireLogin, (req, res) => {
  const postType = req.body.post_type;
  const postId = Number(req.body.post_id);
  const value = Number(req.body.value);

  if (!['question', 'answer'].includes(postType) || ![1, -1].includes(value)) {
    return res.status(400).send('Bad vote.');
  }

  // Resolve which question page to return to.
  let redirectTo = '/';
  if (postType === 'question') {
    if (!q.getQuestion.get(postId)) return res.status(404).render('404');
    redirectTo = `/questions/${postId}`;
  } else {
    const answer = q.getAnswer.get(postId);
    if (!answer) return res.status(404).render('404');
    redirectTo = `/questions/${answer.question_id}#answers`;
  }

  q.castVote(req.session.userId, postType, postId, value);
  res.redirect(redirectTo);
});

// --- Fallback ------------------------------------------------------------
app.use((req, res) => res.status(404).render('404'));

app.listen(PORT, () => {
  console.log(`Q&A site running at http://localhost:${PORT}`);
});
