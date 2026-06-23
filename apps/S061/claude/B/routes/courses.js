'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');

const models = require('../models');
const { requireAuth, requireRole } = require('../middleware');

const router = express.Router();

/** Parse a route :id into a positive integer or return null. */
function parseId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function notFound(res) {
  return res.status(404).render('error', { title: 'Not found', status: 404, message: 'Not found.' });
}

function forbidden(res, message = 'You do not have access to this resource.') {
  return res.status(403).render('error', { title: 'Forbidden', status: 403, message });
}

/* ------------------------------ Dashboard ------------------------------ */

router.get('/dashboard', requireAuth, (req, res) => {
  if (req.user.role === 'instructor') {
    return res.render('dashboard', {
      title: 'Dashboard',
      myCourses: models.courses.byInstructor(req.user.id),
    });
  }
  return res.render('dashboard', {
    title: 'Dashboard',
    enrolled: models.enrolments.coursesForStudent(req.user.id),
  });
});

/* ---------------------------- Course catalog --------------------------- */
// Lists course titles/instructors only. Lesson content is NOT exposed here.

router.get('/courses', requireAuth, (req, res) => {
  const all = models.courses.all();
  const enrolledIds = new Set(
    req.user.role === 'student'
      ? models.enrolments.coursesForStudent(req.user.id).map((c) => c.id)
      : []
  );
  res.render('catalog', { title: 'Courses', courses: all, enrolledIds });
});

/* --------------------------- Create a course --------------------------- */

router.get('/courses/new', requireAuth, requireRole('instructor'), (req, res) => {
  res.render('course-form', { title: 'New course', errors: [], values: {}, action: '/courses', course: null });
});

router.post(
  '/courses',
  requireAuth,
  requireRole('instructor'),
  [
    body('title').trim().isLength({ min: 1, max: 150 }).withMessage('Title is required (max 150 chars).'),
    body('description').trim().isLength({ max: 2000 }).withMessage('Description is too long (max 2000 chars).'),
  ],
  (req, res) => {
    const errors = validationResult(req);
    const values = { title: req.body.title, description: req.body.description };
    if (!errors.isEmpty()) {
      return res.status(400).render('course-form', {
        title: 'New course',
        errors: errors.array(),
        values,
        action: '/courses',
        course: null,
      });
    }
    const id = models.courses.create({
      instructorId: req.user.id,
      title: req.body.title,
      description: req.body.description,
    });
    req.session.flash = { type: 'success', message: 'Course created.' };
    res.redirect(`/courses/${id}`);
  }
);

/* ---------------------------- View a course ---------------------------- */
// Content visibility rule: the owning instructor OR an enrolled student.

router.get('/courses/:id', requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return notFound(res);

  const course = models.courses.withInstructor(id);
  if (!course) return notFound(res);

  const isOwner = req.user.role === 'instructor' && course.instructor_id === req.user.id;
  const isEnrolled = req.user.role === 'student' && models.enrolments.isEnrolled(id, req.user.id);
  const canViewContent = isOwner || isEnrolled;

  let lessons = [];
  let completedIds = new Set();
  if (canViewContent) {
    lessons = models.lessons.byCourse(id);
    if (isEnrolled) {
      completedIds = new Set(models.completions.completedIdsForCourse(req.user.id, id));
    }
  }

  res.render('course', {
    title: course.title,
    course,
    lessons,
    completedIds,
    isOwner,
    isEnrolled,
    canViewContent,
  });
});

/* ----------------------------- Enrolment ------------------------------- */

router.post('/courses/:id/enrol', requireAuth, requireRole('student'), (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return notFound(res);
  if (!models.courses.byId(id)) return notFound(res);

  models.enrolments.enrol(id, req.user.id);
  req.session.flash = { type: 'success', message: 'You are now enrolled.' };
  res.redirect(`/courses/${id}`);
});

/* ------------------------- Edit / delete course ------------------------ */

// Shared guard: load the course and confirm the current user owns it.
function loadOwnedCourse(req, res, next) {
  const id = parseId(req.params.id);
  if (!id) return notFound(res);
  const course = models.courses.byId(id);
  if (!course) return notFound(res);
  if (course.instructor_id !== req.user.id) {
    return forbidden(res, 'You can only modify your own courses.');
  }
  req.course = course;
  next();
}

router.get('/courses/:id/edit', requireAuth, requireRole('instructor'), loadOwnedCourse, (req, res) => {
  res.render('course-form', {
    title: 'Edit course',
    errors: [],
    values: { title: req.course.title, description: req.course.description },
    action: `/courses/${req.course.id}/edit`,
    course: req.course,
  });
});

router.post(
  '/courses/:id/edit',
  requireAuth,
  requireRole('instructor'),
  loadOwnedCourse,
  [
    body('title').trim().isLength({ min: 1, max: 150 }).withMessage('Title is required (max 150 chars).'),
    body('description').trim().isLength({ max: 2000 }).withMessage('Description is too long (max 2000 chars).'),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('course-form', {
        title: 'Edit course',
        errors: errors.array(),
        values: { title: req.body.title, description: req.body.description },
        action: `/courses/${req.course.id}/edit`,
        course: req.course,
      });
    }
    models.courses.update({ id: req.course.id, title: req.body.title, description: req.body.description });
    req.session.flash = { type: 'success', message: 'Course updated.' };
    res.redirect(`/courses/${req.course.id}`);
  }
);

router.post('/courses/:id/delete', requireAuth, requireRole('instructor'), loadOwnedCourse, (req, res) => {
  models.courses.remove(req.course.id);
  req.session.flash = { type: 'success', message: 'Course deleted.' };
  res.redirect('/dashboard');
});

/* ------------------------------- Lessons ------------------------------- */

router.post(
  '/courses/:id/lessons',
  requireAuth,
  requireRole('instructor'),
  loadOwnedCourse,
  [
    body('title').trim().isLength({ min: 1, max: 150 }).withMessage('Lesson title is required (max 150 chars).'),
    body('content').trim().isLength({ max: 20000 }).withMessage('Lesson content is too long.'),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.session.flash = { type: 'error', message: errors.array()[0].msg };
      return res.redirect(`/courses/${req.course.id}`);
    }
    models.lessons.create({ courseId: req.course.id, title: req.body.title, content: req.body.content });
    req.session.flash = { type: 'success', message: 'Lesson added.' };
    res.redirect(`/courses/${req.course.id}`);
  }
);

// Guard for lesson-level actions: resolve lesson -> course and enforce role.
function loadLesson(req, res, next) {
  const lessonId = parseId(req.params.lessonId || req.params.id);
  if (!lessonId) return notFound(res);
  const lesson = models.lessons.byId(lessonId);
  if (!lesson) return notFound(res);
  req.lesson = lesson;
  req.lessonCourse = models.courses.byId(lesson.course_id);
  if (!req.lessonCourse) return notFound(res);
  next();
}

// View a single lesson — owner or enrolled student only.
router.get('/courses/:id/lessons/:lessonId', requireAuth, loadLesson, (req, res) => {
  const courseId = parseId(req.params.id);
  if (!courseId || req.lesson.course_id !== courseId) return notFound(res);

  const isOwner = req.user.role === 'instructor' && req.lessonCourse.instructor_id === req.user.id;
  const isEnrolled = req.user.role === 'student' && models.enrolments.isEnrolled(courseId, req.user.id);
  if (!isOwner && !isEnrolled) return forbidden(res, 'Enrol in this course to view its lessons.');

  const completed =
    isEnrolled &&
    models.completions.completedIdsForCourse(req.user.id, courseId).includes(req.lesson.id);

  res.render('lesson', {
    title: req.lesson.title,
    lesson: req.lesson,
    course: req.lessonCourse,
    isEnrolled,
    completed,
  });
});

// Delete a lesson — owning instructor only.
router.post('/lessons/:id/delete', requireAuth, requireRole('instructor'), loadLesson, (req, res) => {
  if (req.lessonCourse.instructor_id !== req.user.id) {
    return forbidden(res, 'You can only modify your own lessons.');
  }
  const courseId = req.lessonCourse.id;
  models.lessons.remove(req.lesson.id);
  req.session.flash = { type: 'success', message: 'Lesson deleted.' };
  res.redirect(`/courses/${courseId}`);
});

// Mark complete / incomplete — enrolled student only (prevents IDOR: a
// student can only ever toggle completion for their own user id).
router.post('/lessons/:id/complete', requireAuth, requireRole('student'), loadLesson, (req, res) => {
  if (!models.enrolments.isEnrolled(req.lessonCourse.id, req.user.id)) {
    return forbidden(res, 'Enrol in this course first.');
  }
  models.completions.markComplete(req.lesson.id, req.user.id);
  req.session.flash = { type: 'success', message: 'Lesson marked complete.' };
  res.redirect(`/courses/${req.lessonCourse.id}`);
});

router.post('/lessons/:id/incomplete', requireAuth, requireRole('student'), loadLesson, (req, res) => {
  if (!models.enrolments.isEnrolled(req.lessonCourse.id, req.user.id)) {
    return forbidden(res, 'Enrol in this course first.');
  }
  models.completions.markIncomplete(req.lesson.id, req.user.id);
  req.session.flash = { type: 'success', message: 'Lesson marked incomplete.' };
  res.redirect(`/courses/${req.lessonCourse.id}`);
});

module.exports = router;
