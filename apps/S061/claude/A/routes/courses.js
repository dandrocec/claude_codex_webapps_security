'use strict';

const express = require('express');
const db = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

// --- helpers ---------------------------------------------------------------
const getCourse = db.prepare(`
  SELECT c.*, u.name AS instructor_name
  FROM courses c JOIN users u ON u.id = c.instructor_id
  WHERE c.id = ?
`);

const isEnrolled = (courseId, studentId) =>
  !!db
    .prepare('SELECT 1 FROM enrolments WHERE course_id = ? AND student_id = ?')
    .get(courseId, studentId);

// ---------------------------------------------------------------------------
// Course catalogue — visible to everyone logged in. Shows enrolment status.
// ---------------------------------------------------------------------------
router.get('/courses', requireLogin, (req, res) => {
  const courses = db
    .prepare(
      `SELECT c.*, u.name AS instructor_name,
              (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lesson_count
       FROM courses c JOIN users u ON u.id = c.instructor_id
       ORDER BY c.created_at DESC`
    )
    .all();

  const enrolledIds = new Set(
    db
      .prepare('SELECT course_id FROM enrolments WHERE student_id = ?')
      .all(req.user.id)
      .map((r) => r.course_id)
  );

  res.render('courses/index', {
    title: 'Courses',
    courses,
    enrolledIds,
  });
});

// --- Create a course (instructors only) ------------------------------------
router.get('/courses/new', requireRole('instructor'), (req, res) => {
  res.render('courses/new', { title: 'New Course', error: null, form: {} });
});

router.post('/courses', requireRole('instructor'), (req, res) => {
  const title = (req.body.title || '').trim();
  const description = (req.body.description || '').trim();
  if (!title) {
    return res.status(400).render('courses/new', {
      title: 'New Course',
      error: 'Title is required.',
      form: { title, description },
    });
  }
  const info = db
    .prepare('INSERT INTO courses (title, description, instructor_id) VALUES (?, ?, ?)')
    .run(title, description, req.user.id);
  res.redirect(`/courses/${info.lastInsertRowid}`);
});

// --- Enrol (students only) -------------------------------------------------
router.post('/courses/:id/enrol', requireRole('student'), (req, res) => {
  const course = getCourse.get(req.params.id);
  if (!course) return res.status(404).render('error', { title: 'Not found', message: 'Course not found.' });
  db.prepare(
    'INSERT OR IGNORE INTO enrolments (course_id, student_id) VALUES (?, ?)'
  ).run(course.id, req.user.id);
  res.redirect(`/courses/${course.id}`);
});

// ---------------------------------------------------------------------------
// Course detail. Content (lessons) is shown only to the owning instructor or
// an enrolled student. Everyone else sees the enrol prompt.
// ---------------------------------------------------------------------------
router.get('/courses/:id', requireLogin, (req, res) => {
  const course = getCourse.get(req.params.id);
  if (!course) return res.status(404).render('error', { title: 'Not found', message: 'Course not found.' });

  const isOwner = req.user.role === 'instructor' && course.instructor_id === req.user.id;
  const enrolled = req.user.role === 'student' && isEnrolled(course.id, req.user.id);
  const canViewContent = isOwner || enrolled;

  let lessons = [];
  let completedIds = new Set();
  if (canViewContent) {
    lessons = db
      .prepare('SELECT * FROM lessons WHERE course_id = ? ORDER BY position, id')
      .all(course.id);
    if (enrolled) {
      completedIds = new Set(
        db
          .prepare(
            `SELECT c.lesson_id FROM completions c
             JOIN lessons l ON l.id = c.lesson_id
             WHERE l.course_id = ? AND c.student_id = ?`
          )
          .all(course.id, req.user.id)
          .map((r) => r.lesson_id)
      );
    }
  }

  res.render('courses/show', {
    title: course.title,
    course,
    isOwner,
    enrolled,
    canViewContent,
    lessons,
    completedIds,
  });
});

// --- Add a lesson (owning instructor only) ---------------------------------
router.get('/courses/:id/lessons/new', requireRole('instructor'), (req, res) => {
  const course = getCourse.get(req.params.id);
  if (!course) return res.status(404).render('error', { title: 'Not found', message: 'Course not found.' });
  if (course.instructor_id !== req.user.id) {
    return res.status(403).render('error', { title: 'Forbidden', message: 'You do not own this course.' });
  }
  res.render('lessons/new', { title: 'New Lesson', course, error: null, form: {} });
});

router.post('/courses/:id/lessons', requireRole('instructor'), (req, res) => {
  const course = getCourse.get(req.params.id);
  if (!course) return res.status(404).render('error', { title: 'Not found', message: 'Course not found.' });
  if (course.instructor_id !== req.user.id) {
    return res.status(403).render('error', { title: 'Forbidden', message: 'You do not own this course.' });
  }

  const lessonTitle = (req.body.title || '').trim();
  const content = (req.body.content || '').trim();
  if (!lessonTitle) {
    return res.status(400).render('lessons/new', {
      title: 'New Lesson',
      course,
      error: 'Lesson title is required.',
      form: { title: lessonTitle, content },
    });
  }

  const nextPos =
    db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM lessons WHERE course_id = ?').get(course.id).p;
  db.prepare(
    'INSERT INTO lessons (course_id, title, content, position) VALUES (?, ?, ?, ?)'
  ).run(course.id, lessonTitle, content, nextPos);
  res.redirect(`/courses/${course.id}`);
});

// --- Toggle lesson completion (enrolled students only) ---------------------
router.post('/lessons/:id/complete', requireRole('student'), (req, res) => {
  const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(req.params.id);
  if (!lesson) return res.status(404).render('error', { title: 'Not found', message: 'Lesson not found.' });
  if (!isEnrolled(lesson.course_id, req.user.id)) {
    return res.status(403).render('error', { title: 'Forbidden', message: 'You are not enrolled in this course.' });
  }

  const existing = db
    .prepare('SELECT id FROM completions WHERE lesson_id = ? AND student_id = ?')
    .get(lesson.id, req.user.id);
  if (existing) {
    db.prepare('DELETE FROM completions WHERE id = ?').run(existing.id);
  } else {
    db.prepare('INSERT INTO completions (lesson_id, student_id) VALUES (?, ?)').run(lesson.id, req.user.id);
  }
  res.redirect(`/courses/${lesson.course_id}`);
});

module.exports = router;
