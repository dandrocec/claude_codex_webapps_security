const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const bcrypt = require('bcryptjs');
const initSqlJs = require('sql.js');

const PORT = Number(process.env.PORT || 5063);
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'social.sqlite');

let db;

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function run(sql, params = []) {
  db.run(sql, params);
  persist();
}

function one(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function currentTimestamp() {
  return new Date().toISOString();
}

async function initializeDatabase() {
  const SQL = await initSqlJs();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }

  db.run(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS follows (
      follower_id INTEGER NOT NULL,
      following_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (follower_id, following_id),
      FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE,
      CHECK (follower_id <> following_id)
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_posts_user_created ON posts(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
    CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);
  `);
  persist();
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    req.flash('error', 'Please sign in first.');
    return res.redirect('/login');
  }
  next();
}

function attachCurrentUser(req, res, next) {
  const user = req.session.userId
    ? one('SELECT id, username, email, display_name, bio, location, created_at FROM users WHERE id = ?', [req.session.userId])
    : null;
  req.currentUser = user;
  res.locals.currentUser = user;
  res.locals.messages = {
    error: req.flash('error'),
    success: req.flash('success')
  };
  next();
}

function findUserByLogin(login) {
  return one('SELECT * FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)', [login, login]);
}

function getProfile(username, viewerId) {
  const user = one(
    `SELECT
      u.id, u.username, u.email, u.display_name, u.bio, u.location, u.created_at,
      (SELECT COUNT(*) FROM follows WHERE following_id = u.id) AS followers_count,
      (SELECT COUNT(*) FROM follows WHERE follower_id = u.id) AS following_count,
      (SELECT COUNT(*) FROM posts WHERE user_id = u.id) AS posts_count
    FROM users u
    WHERE lower(u.username) = lower(?)`,
    [username]
  );

  if (!user) return null;
  user.is_following = viewerId
    ? Boolean(one('SELECT 1 AS ok FROM follows WHERE follower_id = ? AND following_id = ?', [viewerId, user.id]))
    : false;
  return user;
}

function hydratePosts(posts) {
  return posts.map((post) => ({
    ...post,
    created_label: new Date(post.created_at).toLocaleString()
  }));
}

function createApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.use(express.static(path.join(__dirname, 'public')));
  app.use(express.urlencoded({ extended: false }));
  app.use(methodOverride('_method'));
  app.use(session({
    secret: process.env.SESSION_SECRET || 'local-development-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { sameSite: 'lax' }
  }));
  app.use(flash());
  app.use(attachCurrentUser);

  app.get('/', (req, res) => {
    if (req.currentUser) return res.redirect('/feed');
    res.render('home', { title: 'StatusHub' });
  });

  app.get('/register', (req, res) => {
    res.render('register', { title: 'Create account' });
  });

  app.post('/register', async (req, res) => {
    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim();
    const displayName = String(req.body.display_name || '').trim();
    const password = String(req.body.password || '');

    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
      req.flash('error', 'Username must be 3-24 characters and use only letters, numbers, and underscores.');
      return res.redirect('/register');
    }
    if (!email.includes('@') || email.length > 120) {
      req.flash('error', 'Enter a valid email address.');
      return res.redirect('/register');
    }
    if (!displayName || displayName.length > 60) {
      req.flash('error', 'Display name is required and must be under 60 characters.');
      return res.redirect('/register');
    }
    if (password.length < 8) {
      req.flash('error', 'Password must be at least 8 characters.');
      return res.redirect('/register');
    }
    if (one('SELECT id FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)', [username, email])) {
      req.flash('error', 'That username or email is already registered.');
      return res.redirect('/register');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    run(
      'INSERT INTO users (username, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)',
      [username, email, passwordHash, displayName, currentTimestamp()]
    );
    const user = one('SELECT id FROM users WHERE username = ?', [username]);
    req.session.userId = user.id;
    req.flash('success', 'Account created. Add a few profile details.');
    res.redirect('/profile/edit');
  });

  app.get('/login', (req, res) => {
    res.render('login', { title: 'Sign in' });
  });

  app.post('/login', async (req, res) => {
    const login = String(req.body.login || '').trim();
    const password = String(req.body.password || '');
    const user = findUserByLogin(login);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      req.flash('error', 'Invalid login details.');
      return res.redirect('/login');
    }
    req.session.userId = user.id;
    req.flash('success', `Welcome back, ${user.display_name}.`);
    res.redirect('/feed');
  });

  app.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
  });

  app.get('/profile/edit', requireAuth, (req, res) => {
    res.render('edit-profile', { title: 'Edit profile' });
  });

  app.post('/profile/edit', requireAuth, (req, res) => {
    const displayName = String(req.body.display_name || '').trim();
    const bio = String(req.body.bio || '').trim();
    const location = String(req.body.location || '').trim();

    if (!displayName || displayName.length > 60) {
      req.flash('error', 'Display name is required and must be under 60 characters.');
      return res.redirect('/profile/edit');
    }
    if (bio.length > 240) {
      req.flash('error', 'Bio must be 240 characters or fewer.');
      return res.redirect('/profile/edit');
    }
    if (location.length > 80) {
      req.flash('error', 'Location must be 80 characters or fewer.');
      return res.redirect('/profile/edit');
    }

    run('UPDATE users SET display_name = ?, bio = ?, location = ? WHERE id = ?', [
      displayName,
      bio,
      location,
      req.currentUser.id
    ]);
    req.flash('success', 'Profile updated.');
    res.redirect(`/users/${req.currentUser.username}`);
  });

  app.get('/feed', requireAuth, (req, res) => {
    const posts = hydratePosts(all(
      `SELECT p.id, p.body, p.created_at, u.username, u.display_name
       FROM posts p
       JOIN users u ON u.id = p.user_id
       WHERE p.user_id = ?
          OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT 80`,
      [req.currentUser.id, req.currentUser.id]
    ));
    res.render('feed', { title: 'Your feed', posts });
  });

  app.post('/posts', requireAuth, (req, res) => {
    const body = String(req.body.body || '').trim();
    if (!body || body.length > 280) {
      req.flash('error', 'Status updates must be between 1 and 280 characters.');
      return res.redirect('/feed');
    }
    run('INSERT INTO posts (user_id, body, created_at) VALUES (?, ?, ?)', [
      req.currentUser.id,
      body,
      currentTimestamp()
    ]);
    req.flash('success', 'Status posted.');
    res.redirect('/feed');
  });

  app.delete('/posts/:id', requireAuth, (req, res) => {
    run('DELETE FROM posts WHERE id = ? AND user_id = ?', [req.params.id, req.currentUser.id]);
    req.flash('success', 'Status deleted.');
    res.redirect('/feed');
  });

  app.get('/discover', requireAuth, (req, res) => {
    const query = String(req.query.q || '').trim();
    const params = query
      ? [req.currentUser.id, `%${query}%`, `%${query}%`, `%${query}%`]
      : [req.currentUser.id];
    const users = all(
      `SELECT
        u.id, u.username, u.display_name, u.bio, u.location,
        EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.following_id = u.id) AS is_following,
        (SELECT COUNT(*) FROM follows WHERE following_id = u.id) AS followers_count
       FROM users u
       WHERE u.id <> ?
       ${query ? 'AND (u.username LIKE ? OR u.display_name LIKE ? OR u.bio LIKE ?)' : ''}
       ORDER BY followers_count DESC, u.display_name COLLATE NOCASE
       LIMIT 60`,
      query ? [req.currentUser.id, ...params] : [req.currentUser.id, req.currentUser.id]
    );
    res.render('discover', { title: 'Discover people', users, query });
  });

  app.get('/users/:username', (req, res) => {
    const profile = getProfile(req.params.username, req.currentUser && req.currentUser.id);
    if (!profile) return res.status(404).render('not-found', { title: 'Profile not found' });
    const posts = hydratePosts(all(
      `SELECT p.id, p.body, p.created_at, u.username, u.display_name
       FROM posts p
       JOIN users u ON u.id = p.user_id
       WHERE p.user_id = ?
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT 80`,
      [profile.id]
    ));
    res.render('profile', { title: profile.display_name, profile, posts });
  });

  app.post('/users/:username/follow', requireAuth, (req, res) => {
    const target = one('SELECT id, username FROM users WHERE lower(username) = lower(?)', [req.params.username]);
    if (!target) return res.status(404).render('not-found', { title: 'Profile not found' });
    if (target.id !== req.currentUser.id) {
      run('INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)', [
        req.currentUser.id,
        target.id,
        currentTimestamp()
      ]);
    }
    res.redirect(`/users/${target.username}`);
  });

  app.delete('/users/:username/follow', requireAuth, (req, res) => {
    const target = one('SELECT id, username FROM users WHERE lower(username) = lower(?)', [req.params.username]);
    if (!target) return res.status(404).render('not-found', { title: 'Profile not found' });
    run('DELETE FROM follows WHERE follower_id = ? AND following_id = ?', [req.currentUser.id, target.id]);
    res.redirect(`/users/${target.username}`);
  });

  app.use((req, res) => {
    res.status(404).render('not-found', { title: 'Page not found' });
  });

  return app;
}

initializeDatabase().then(() => {
  createApp().listen(PORT, () => {
    console.log(`Social app running on http://localhost:${PORT}`);
  });
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
