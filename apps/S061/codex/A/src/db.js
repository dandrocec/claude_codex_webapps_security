const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'elearning.sqlite'));
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('instructor', 'student')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instructor_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    published INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (instructor_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS lessons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS enrolments (
    student_id INTEGER NOT NULL,
    course_id INTEGER NOT NULL,
    enrolled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (student_id, course_id),
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS lesson_completions (
    student_id INTEGER NOT NULL,
    lesson_id INTEGER NOT NULL,
    completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (student_id, lesson_id),
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
  );
`);

function createUser({ name, email, passwordHash, role }) {
  const info = db
    .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name.trim(), email.trim(), passwordHash, role);
  return db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(info.lastInsertRowid);
}

function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function createCourse({ instructorId, title, description, published }) {
  const info = db
    .prepare('INSERT INTO courses (instructor_id, title, description, published) VALUES (?, ?, ?, ?)')
    .run(instructorId, title.trim(), description.trim(), published ? 1 : 0);
  return getCourse(info.lastInsertRowid);
}

function updateCourse(id, { title, description, published }) {
  db.prepare('UPDATE courses SET title = ?, description = ?, published = ? WHERE id = ?').run(
    title.trim(),
    description.trim(),
    published ? 1 : 0,
    id
  );
}

function getCourse(id) {
  return db
    .prepare(
      `SELECT courses.*, users.name AS instructor_name
       FROM courses
       JOIN users ON users.id = courses.instructor_id
       WHERE courses.id = ?`
    )
    .get(id);
}

function listPublishedCourses() {
  return db
    .prepare(
      `SELECT courses.*, users.name AS instructor_name,
        (SELECT COUNT(*) FROM lessons WHERE lessons.course_id = courses.id) AS lesson_count
       FROM courses
       JOIN users ON users.id = courses.instructor_id
       WHERE courses.published = 1
       ORDER BY courses.created_at DESC`
    )
    .all();
}

function listInstructorCourses(instructorId) {
  return db
    .prepare(
      `SELECT courses.*,
        (SELECT COUNT(*) FROM lessons WHERE lessons.course_id = courses.id) AS lesson_count,
        (SELECT COUNT(*) FROM enrolments WHERE enrolments.course_id = courses.id) AS student_count
       FROM courses
       WHERE instructor_id = ?
       ORDER BY created_at DESC`
    )
    .all(instructorId);
}

function createLesson({ courseId, title, content }) {
  const nextPosition =
    db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS position FROM lessons WHERE course_id = ?').get(courseId)
      .position || 1;
  const info = db
    .prepare('INSERT INTO lessons (course_id, title, content, position) VALUES (?, ?, ?, ?)')
    .run(courseId, title.trim(), content.trim(), nextPosition);
  return db.prepare('SELECT * FROM lessons WHERE id = ?').get(info.lastInsertRowid);
}

function getLesson(id) {
  return db
    .prepare(
      `SELECT lessons.*, courses.instructor_id
       FROM lessons
       JOIN courses ON courses.id = lessons.course_id
       WHERE lessons.id = ?`
    )
    .get(id);
}

function deleteLesson(id) {
  db.prepare('DELETE FROM lessons WHERE id = ?').run(id);
}

function listLessons(courseId) {
  return db.prepare('SELECT * FROM lessons WHERE course_id = ? ORDER BY position ASC, id ASC').all(courseId);
}

function enrolStudent(studentId, courseId) {
  db.prepare('INSERT OR IGNORE INTO enrolments (student_id, course_id) VALUES (?, ?)').run(studentId, courseId);
}

function isEnrolled(studentId, courseId) {
  return Boolean(db.prepare('SELECT 1 FROM enrolments WHERE student_id = ? AND course_id = ?').get(studentId, courseId));
}

function listStudentCourses(studentId) {
  return db
    .prepare(
      `SELECT courses.*, users.name AS instructor_name,
        COUNT(lessons.id) AS lesson_count,
        COUNT(lesson_completions.lesson_id) AS completed_count
       FROM enrolments
       JOIN courses ON courses.id = enrolments.course_id
       JOIN users ON users.id = courses.instructor_id
       LEFT JOIN lessons ON lessons.course_id = courses.id
       LEFT JOIN lesson_completions ON lesson_completions.lesson_id = lessons.id
        AND lesson_completions.student_id = enrolments.student_id
       WHERE enrolments.student_id = ?
       GROUP BY courses.id
       ORDER BY enrolments.enrolled_at DESC`
    )
    .all(studentId);
}

function listLessonsWithProgress(courseId, studentId) {
  return db
    .prepare(
      `SELECT lessons.*,
        CASE WHEN lesson_completions.lesson_id IS NULL THEN 0 ELSE 1 END AS completed
       FROM lessons
       LEFT JOIN lesson_completions ON lesson_completions.lesson_id = lessons.id
        AND lesson_completions.student_id = ?
       WHERE lessons.course_id = ?
       ORDER BY lessons.position ASC, lessons.id ASC`
    )
    .all(studentId, courseId);
}

function markLessonComplete(studentId, lessonId) {
  db.prepare('INSERT OR IGNORE INTO lesson_completions (student_id, lesson_id) VALUES (?, ?)').run(studentId, lessonId);
}

module.exports = {
  createUser,
  findUserByEmail,
  createCourse,
  updateCourse,
  getCourse,
  listPublishedCourses,
  listInstructorCourses,
  createLesson,
  getLesson,
  deleteLesson,
  listLessons,
  enrolStudent,
  isEnrolled,
  listStudentCourses,
  listLessonsWithProgress,
  markLessonComplete
};
