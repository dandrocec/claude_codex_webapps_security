'use strict';

// All database access lives here. Every statement uses bound parameters
// (never string concatenation) so user input can never alter SQL structure.

const db = require('./db');

/* ----------------------------- Users ----------------------------- */

const insertUser = db.prepare(
  `INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)`
);
const findUserByEmail = db.prepare(`SELECT * FROM users WHERE email = ?`);
const findUserById = db.prepare(`SELECT * FROM users WHERE id = ?`);

const users = {
  create({ name, email, passwordHash, role }) {
    const info = insertUser.run(name, email, passwordHash, role);
    return info.lastInsertRowid;
  },
  byEmail(email) {
    return findUserByEmail.get(email);
  },
  byId(id) {
    return findUserById.get(id);
  },
};

/* ---------------------------- Courses ----------------------------- */

const insertCourse = db.prepare(
  `INSERT INTO courses (instructor_id, title, description) VALUES (?, ?, ?)`
);
const findCourseById = db.prepare(`SELECT * FROM courses WHERE id = ?`);
const listAllCourses = db.prepare(`
  SELECT c.*, u.name AS instructor_name,
         (SELECT COUNT(*) FROM enrolments e WHERE e.course_id = c.id) AS student_count
  FROM courses c
  JOIN users u ON u.id = c.instructor_id
  ORDER BY c.created_at DESC
`);
const listCoursesByInstructor = db.prepare(`
  SELECT c.*,
         (SELECT COUNT(*) FROM enrolments e WHERE e.course_id = c.id) AS student_count
  FROM courses c
  WHERE c.instructor_id = ?
  ORDER BY c.created_at DESC
`);
const updateCourse = db.prepare(
  `UPDATE courses SET title = ?, description = ? WHERE id = ?`
);
const deleteCourse = db.prepare(`DELETE FROM courses WHERE id = ?`);

const courses = {
  create({ instructorId, title, description }) {
    return insertCourse.run(instructorId, title, description).lastInsertRowid;
  },
  byId(id) {
    return findCourseById.get(id);
  },
  withInstructor(id) {
    return db
      .prepare(
        `SELECT c.*, u.name AS instructor_name
         FROM courses c JOIN users u ON u.id = c.instructor_id
         WHERE c.id = ?`
      )
      .get(id);
  },
  all() {
    return listAllCourses.all();
  },
  byInstructor(instructorId) {
    return listCoursesByInstructor.all(instructorId);
  },
  update({ id, title, description }) {
    updateCourse.run(title, description, id);
  },
  remove(id) {
    deleteCourse.run(id);
  },
};

/* ---------------------------- Lessons ----------------------------- */

const insertLesson = db.prepare(
  `INSERT INTO lessons (course_id, title, content, position) VALUES (?, ?, ?, ?)`
);
const findLessonById = db.prepare(`SELECT * FROM lessons WHERE id = ?`);
const listLessonsByCourse = db.prepare(
  `SELECT * FROM lessons WHERE course_id = ? ORDER BY position ASC, id ASC`
);
const nextPosition = db.prepare(
  `SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM lessons WHERE course_id = ?`
);
const deleteLesson = db.prepare(`DELETE FROM lessons WHERE id = ?`);

const lessons = {
  create({ courseId, title, content }) {
    const position = nextPosition.get(courseId).pos;
    return insertLesson.run(courseId, title, content, position).lastInsertRowid;
  },
  byId(id) {
    return findLessonById.get(id);
  },
  byCourse(courseId) {
    return listLessonsByCourse.all(courseId);
  },
  remove(id) {
    deleteLesson.run(id);
  },
};

/* -------------------------- Enrolments ---------------------------- */

const insertEnrolment = db.prepare(
  `INSERT OR IGNORE INTO enrolments (course_id, student_id) VALUES (?, ?)`
);
const findEnrolment = db.prepare(
  `SELECT 1 FROM enrolments WHERE course_id = ? AND student_id = ?`
);
const listEnrolledCourses = db.prepare(`
  SELECT c.*, u.name AS instructor_name
  FROM enrolments e
  JOIN courses c ON c.id = e.course_id
  JOIN users u ON u.id = c.instructor_id
  WHERE e.student_id = ?
  ORDER BY e.created_at DESC
`);

const enrolments = {
  enrol(courseId, studentId) {
    insertEnrolment.run(courseId, studentId);
  },
  isEnrolled(courseId, studentId) {
    return Boolean(findEnrolment.get(courseId, studentId));
  },
  coursesForStudent(studentId) {
    return listEnrolledCourses.all(studentId);
  },
};

/* -------------------------- Completions --------------------------- */

const insertCompletion = db.prepare(
  `INSERT OR IGNORE INTO completions (lesson_id, student_id) VALUES (?, ?)`
);
const removeCompletion = db.prepare(
  `DELETE FROM completions WHERE lesson_id = ? AND student_id = ?`
);
const listCompletedLessonIds = db.prepare(`
  SELECT c.lesson_id
  FROM completions c
  JOIN lessons l ON l.id = c.lesson_id
  WHERE c.student_id = ? AND l.course_id = ?
`);

const completions = {
  markComplete(lessonId, studentId) {
    insertCompletion.run(lessonId, studentId);
  },
  markIncomplete(lessonId, studentId) {
    removeCompletion.run(lessonId, studentId);
  },
  completedIdsForCourse(studentId, courseId) {
    return listCompletedLessonIds.all(studentId, courseId).map((r) => r.lesson_id);
  },
};

module.exports = { users, courses, lessons, enrolments, completions };
