const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const db = require('./src/db');

const app = express();
const PORT = Number(process.env.PORT || 5061);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(__dirname, 'data') }),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' }
  })
);

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

function flash(req, message, type = 'info') {
  req.session.flash = { message, type };
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    flash(req, 'Please sign in first.', 'error');
    return res.redirect('/login');
  }
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user || req.session.user.role !== role) {
      flash(req, 'You do not have permission to access that page.', 'error');
      return res.redirect('/');
    }
    next();
  };
}

function loadCourse(req, res, next) {
  const course = db.getCourse(Number(req.params.id));
  if (!course) {
    flash(req, 'Course not found.', 'error');
    return res.redirect('/courses');
  }
  req.course = course;
  next();
}

app.get('/', (req, res) => {
  const featuredCourses = db.listPublishedCourses().slice(0, 6);
  res.render('home', { title: 'LearnDeck', featuredCourses });
});

app.get('/register', (req, res) => {
  res.render('register', { title: 'Create Account' });
});

app.post('/register', (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !['instructor', 'student'].includes(role)) {
    flash(req, 'Complete all fields with a valid role.', 'error');
    return res.redirect('/register');
  }
  try {
    const passwordHash = bcrypt.hashSync(password, 10);
    const user = db.createUser({ name, email: email.toLowerCase().trim(), passwordHash, role });
    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    flash(req, 'Account created.');
    res.redirect('/dashboard');
  } catch (error) {
    flash(req, 'That email is already registered.', 'error');
    res.redirect('/register');
  }
});

app.get('/login', (req, res) => {
  res.render('login', { title: 'Sign In' });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.findUserByEmail(String(email || '').toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    flash(req, 'Invalid email or password.', 'error');
    return res.redirect('/login');
  }
  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  flash(req, 'Signed in.');
  res.redirect('/dashboard');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/dashboard', requireAuth, (req, res) => {
  if (req.session.user.role === 'instructor') {
    const courses = db.listInstructorCourses(req.session.user.id);
    return res.render('instructor-dashboard', { title: 'Instructor Dashboard', courses });
  }
  const courses = db.listStudentCourses(req.session.user.id);
  res.render('student-dashboard', { title: 'Student Dashboard', courses });
});

app.get('/courses', (req, res) => {
  const courses = db.listPublishedCourses();
  res.render('courses', { title: 'Courses', courses });
});

app.get('/courses/new', requireAuth, requireRole('instructor'), (req, res) => {
  res.render('course-form', { title: 'New Course', course: {}, action: '/courses' });
});

app.post('/courses', requireAuth, requireRole('instructor'), (req, res) => {
  const { title, description, published } = req.body;
  if (!title || !description) {
    flash(req, 'Course title and description are required.', 'error');
    return res.redirect('/courses/new');
  }
  const course = db.createCourse({
    instructorId: req.session.user.id,
    title,
    description,
    published: published === 'on'
  });
  flash(req, 'Course created.');
  res.redirect(`/instructor/courses/${course.id}`);
});

app.get('/instructor/courses/:id', requireAuth, requireRole('instructor'), loadCourse, (req, res) => {
  if (req.course.instructor_id !== req.session.user.id) {
    flash(req, 'You can only manage your own courses.', 'error');
    return res.redirect('/dashboard');
  }
  const lessons = db.listLessons(req.course.id);
  res.render('instructor-course', { title: req.course.title, course: req.course, lessons });
});

app.get('/instructor/courses/:id/edit', requireAuth, requireRole('instructor'), loadCourse, (req, res) => {
  if (req.course.instructor_id !== req.session.user.id) {
    flash(req, 'You can only edit your own courses.', 'error');
    return res.redirect('/dashboard');
  }
  res.render('course-form', { title: 'Edit Course', course: req.course, action: `/instructor/courses/${req.course.id}` });
});

app.post('/instructor/courses/:id', requireAuth, requireRole('instructor'), loadCourse, (req, res) => {
  if (req.course.instructor_id !== req.session.user.id) {
    flash(req, 'You can only edit your own courses.', 'error');
    return res.redirect('/dashboard');
  }
  const { title, description, published } = req.body;
  db.updateCourse(req.course.id, { title, description, published: published === 'on' });
  flash(req, 'Course updated.');
  res.redirect(`/instructor/courses/${req.course.id}`);
});

app.post('/instructor/courses/:id/lessons', requireAuth, requireRole('instructor'), loadCourse, (req, res) => {
  if (req.course.instructor_id !== req.session.user.id) {
    flash(req, 'You can only add lessons to your own courses.', 'error');
    return res.redirect('/dashboard');
  }
  const { title, content } = req.body;
  if (!title || !content) {
    flash(req, 'Lesson title and content are required.', 'error');
    return res.redirect(`/instructor/courses/${req.course.id}`);
  }
  db.createLesson({ courseId: req.course.id, title, content });
  flash(req, 'Lesson added.');
  res.redirect(`/instructor/courses/${req.course.id}`);
});

app.post('/instructor/lessons/:lessonId/delete', requireAuth, requireRole('instructor'), (req, res) => {
  const lesson = db.getLesson(Number(req.params.lessonId));
  if (!lesson || lesson.instructor_id !== req.session.user.id) {
    flash(req, 'Lesson not found.', 'error');
    return res.redirect('/dashboard');
  }
  db.deleteLesson(lesson.id);
  flash(req, 'Lesson deleted.');
  res.redirect(`/instructor/courses/${lesson.course_id}`);
});

app.get('/courses/:id', requireAuth, loadCourse, (req, res) => {
  if (req.session.user.role === 'instructor') {
    if (req.course.instructor_id === req.session.user.id) {
      return res.redirect(`/instructor/courses/${req.course.id}`);
    }
    flash(req, 'Instructors can only view enrolled content through a student account.', 'error');
    return res.redirect('/courses');
  }

  const enrolled = db.isEnrolled(req.session.user.id, req.course.id);
  if (!enrolled) {
    return res.render('course-public', { title: req.course.title, course: req.course });
  }

  const lessons = db.listLessonsWithProgress(req.course.id, req.session.user.id);
  res.render('course-content', { title: req.course.title, course: req.course, lessons });
});

app.post('/courses/:id/enrol', requireAuth, requireRole('student'), loadCourse, (req, res) => {
  if (!req.course.published) {
    flash(req, 'This course is not open for enrolment.', 'error');
    return res.redirect('/courses');
  }
  db.enrolStudent(req.session.user.id, req.course.id);
  flash(req, 'You are enrolled.');
  res.redirect(`/courses/${req.course.id}`);
});

app.post('/lessons/:lessonId/complete', requireAuth, requireRole('student'), (req, res) => {
  const lesson = db.getLesson(Number(req.params.lessonId));
  if (!lesson || !db.isEnrolled(req.session.user.id, lesson.course_id)) {
    flash(req, 'Lesson content is only available after enrolment.', 'error');
    return res.redirect('/courses');
  }
  db.markLessonComplete(req.session.user.id, lesson.id);
  flash(req, 'Lesson marked complete.');
  res.redirect(`/courses/${lesson.course_id}`);
});

app.use((req, res) => {
  res.status(404).render('404', { title: 'Not Found' });
});

app.listen(PORT, () => {
  console.log(`E-learning app running on http://localhost:${PORT}`);
});
