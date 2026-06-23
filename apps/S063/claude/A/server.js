'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5063;

// ---------- View engine & middleware ----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: __dirname }),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }, // 1 week
  })
);

// Make the current user (if any) available to every view.
app.use((req, res, next) => {
  res.locals.currentUser = null;
  if (req.session.userId) {
    res.locals.currentUser = db
      .prepare('SELECT id, username, display_name, bio FROM users WHERE id = ?')
      .get(req.session.userId);
  }
  next();
});

// ---------- Auth helpers ----------
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

function displayNameOf(user) {
  return user.display_name && user.display_name.trim() ? user.display_name : user.username;
}
app.locals.displayNameOf = displayNameOf;

// ---------- Routes ----------

// Home: redirect to feed if logged in, otherwise to login.
app.get('/', (req, res) => {
  res.redirect(req.session.userId ? '/feed' : '/login');
});

// --- Registration ---
app.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/feed');
  res.render('register', { error: null, values: {} });
});

app.post('/register', async (req, res) => {
  const username = (req.body.username || '').trim().toLowerCase();
  const password = req.body.password || '';
  const displayName = (req.body.display_name || '').trim();

  const values = { username, display_name: displayName };

  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return res.status(400).render('register', {
      error: 'Username must be 3-20 characters: letters, numbers, or underscore.',
      values,
    });
  }
  if (password.length < 6) {
    return res.status(400).render('register', {
      error: 'Password must be at least 6 characters.',
      values,
    });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).render('register', {
      error: 'That username is already taken.',
      values,
    });
  }

  const hash = await bcrypt.hash(password, 10);
  const info = db
    .prepare('INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)')
    .run(username, hash, displayName);

  req.session.userId = info.lastInsertRowid;
  res.redirect('/profile/edit');
});

// --- Login / Logout ---
app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/feed');
  res.render('login', { error: null, values: {} });
});

app.post('/login', async (req, res) => {
  const username = (req.body.username || '').trim().toLowerCase();
  const password = req.body.password || '';

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const ok = user && (await bcrypt.compare(password, user.password_hash));
  if (!ok) {
    return res.status(401).render('login', {
      error: 'Invalid username or password.',
      values: { username },
    });
  }

  req.session.userId = user.id;
  res.redirect('/feed');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// --- Profile setup / edit ---
app.get('/profile/edit', requireAuth, (req, res) => {
  res.render('profile_edit', { error: null, user: res.locals.currentUser });
});

app.post('/profile/edit', requireAuth, (req, res) => {
  const displayName = (req.body.display_name || '').trim();
  const bio = (req.body.bio || '').trim();

  if (displayName.length > 50) {
    return res.status(400).render('profile_edit', {
      error: 'Display name must be 50 characters or fewer.',
      user: { ...res.locals.currentUser, display_name: displayName, bio },
    });
  }
  if (bio.length > 280) {
    return res.status(400).render('profile_edit', {
      error: 'Bio must be 280 characters or fewer.',
      user: { ...res.locals.currentUser, display_name: displayName, bio },
    });
  }

  db.prepare('UPDATE users SET display_name = ?, bio = ? WHERE id = ?').run(
    displayName,
    bio,
    req.session.userId
  );
  res.redirect('/profile/' + res.locals.currentUser.username);
});

// --- Create a post ---
app.post('/posts', requireAuth, (req, res) => {
  const body = (req.body.body || '').trim();
  if (body.length === 0 || body.length > 280) {
    // Silently ignore empty/oversized posts and return to where we came from.
    return res.redirect(req.get('referer') || '/feed');
  }
  db.prepare('INSERT INTO posts (user_id, body) VALUES (?, ?)').run(req.session.userId, body);
  res.redirect(req.get('referer') || '/feed');
});

// --- Feed: posts from people you follow, plus your own ---
app.get('/feed', requireAuth, (req, res) => {
  const posts = db
    .prepare(
      `SELECT p.id, p.body, p.created_at,
              u.username, u.display_name
         FROM posts p
         JOIN users u ON u.id = p.user_id
        WHERE p.user_id = @me
           OR p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = @me)
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT 100`
    )
    .all({ me: req.session.userId });

  res.render('feed', { posts });
});

// --- Discover people to follow ---
app.get('/people', requireAuth, (req, res) => {
  const me = req.session.userId;
  const people = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.bio,
              EXISTS(SELECT 1 FROM follows f
                      WHERE f.follower_id = @me AND f.followee_id = u.id) AS is_following
         FROM users u
        WHERE u.id != @me
        ORDER BY u.created_at DESC`
    )
    .all({ me });

  res.render('people', { people });
});

// --- Follow / Unfollow ---
app.post('/follow/:id', requireAuth, (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId && targetId !== req.session.userId) {
    db.prepare(
      'INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)'
    ).run(req.session.userId, targetId);
  }
  res.redirect(req.get('referer') || '/people');
});

app.post('/unfollow/:id', requireAuth, (req, res) => {
  const targetId = Number(req.params.id);
  db.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').run(
    req.session.userId,
    targetId
  );
  res.redirect(req.get('referer') || '/people');
});

// --- A user's profile page ---
app.get('/profile/:username', requireAuth, (req, res) => {
  const username = (req.params.username || '').toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(404).render('not_found');

  const posts = db
    .prepare(
      `SELECT id, body, created_at FROM posts
        WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`
    )
    .all(user.id);

  const counts = {
    posts: posts.length,
    following: db
      .prepare('SELECT COUNT(*) AS c FROM follows WHERE follower_id = ?')
      .get(user.id).c,
    followers: db
      .prepare('SELECT COUNT(*) AS c FROM follows WHERE followee_id = ?')
      .get(user.id).c,
  };

  const isSelf = user.id === req.session.userId;
  const isFollowing =
    !isSelf &&
    !!db
      .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?')
      .get(req.session.userId, user.id);

  res.render('profile', { profile: user, posts, counts, isSelf, isFollowing });
});

// ---------- Fallbacks ----------
app.use((req, res) => res.status(404).render('not_found'));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Something went wrong.');
});

app.listen(PORT, () => {
  console.log(`mini-social listening on http://localhost:${PORT}`);
});
