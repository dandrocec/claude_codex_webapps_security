'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');

const db = require('./db');
const { loadUser, requireLogin } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const courseRoutes = require('./routes/courses');

const PORT = process.env.PORT || 5061;
const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// Sessions use the default in-memory store — fine for a local demo (sessions
// reset when the server restarts). Course/user data is persisted in SQLite.
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }, // 1 week
  })
);

app.use(loadUser);

// --- Home ------------------------------------------------------------------
app.get('/', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('home', { title: 'Welcome' });
});

// --- Dashboard: role-specific overview -------------------------------------
app.get('/dashboard', requireLogin, (req, res) => {
  if (req.user.role === 'instructor') {
    const courses = db
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id)   AS lesson_count,
                (SELECT COUNT(*) FROM enrolments e WHERE e.course_id = c.id) AS student_count
         FROM courses c WHERE c.instructor_id = ? ORDER BY c.created_at DESC`
      )
      .all(req.user.id);
    return res.render('dashboard_instructor', { title: 'Dashboard', courses });
  }

  // student
  const courses = db
    .prepare(
      `SELECT c.*, u.name AS instructor_name,
              (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lesson_count,
              (SELECT COUNT(*) FROM completions cm
                 JOIN lessons l ON l.id = cm.lesson_id
                 WHERE l.course_id = c.id AND cm.student_id = ?) AS completed_count
       FROM enrolments e
       JOIN courses c ON c.id = e.course_id
       JOIN users u ON u.id = c.instructor_id
       WHERE e.student_id = ?
       ORDER BY e.enrolled_at DESC`
    )
    .all(req.user.id, req.user.id);
  res.render('dashboard_student', { title: 'Dashboard', courses });
});

app.use(authRoutes);
app.use(courseRoutes);

// --- 404 -------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: 'Page not found.' });
});

app.listen(PORT, () => {
  console.log(`E-learning app running at http://localhost:${PORT}`);
});
