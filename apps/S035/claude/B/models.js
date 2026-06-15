'use strict';

const db = require('./db');

// ---------------------------------------------------------------------------
// All queries below use parameterised prepared statements (no string concat),
// which prevents SQL injection.
// ---------------------------------------------------------------------------

// ----- Users -----
const insertUserStmt = db.prepare(
  'INSERT INTO users (username, password_hash) VALUES (?, ?)'
);
const getUserByNameStmt = db.prepare(
  'SELECT id, username, password_hash FROM users WHERE username = ?'
);
const getUserByIdStmt = db.prepare(
  'SELECT id, username FROM users WHERE id = ?'
);

function createUser(username, passwordHash) {
  const info = insertUserStmt.run(username, passwordHash);
  return info.lastInsertRowid;
}

function getUserByUsername(username) {
  return getUserByNameStmt.get(username);
}

function getUserById(id) {
  return getUserByIdStmt.get(id);
}

// ----- Habits -----
const insertHabitStmt = db.prepare(
  'INSERT INTO habits (user_id, name) VALUES (?, ?)'
);
const listHabitsStmt = db.prepare(
  'SELECT id, name, created_at FROM habits WHERE user_id = ? ORDER BY created_at ASC, id ASC'
);
// Ownership is always enforced in the WHERE clause to prevent IDOR.
const getHabitStmt = db.prepare(
  'SELECT id, name, user_id FROM habits WHERE id = ? AND user_id = ?'
);
const deleteHabitStmt = db.prepare(
  'DELETE FROM habits WHERE id = ? AND user_id = ?'
);

function createHabit(userId, name) {
  const info = insertHabitStmt.run(userId, name);
  return info.lastInsertRowid;
}

function listHabits(userId) {
  return listHabitsStmt.all(userId);
}

function getOwnedHabit(habitId, userId) {
  return getHabitStmt.get(habitId, userId);
}

function deleteHabit(habitId, userId) {
  return deleteHabitStmt.run(habitId, userId).changes > 0;
}

// ----- Check-ins -----
const addCheckinStmt = db.prepare(
  'INSERT OR IGNORE INTO checkins (habit_id, day) VALUES (?, ?)'
);
const removeCheckinStmt = db.prepare(
  'DELETE FROM checkins WHERE habit_id = ? AND day = ?'
);
const getCheckinStmt = db.prepare(
  'SELECT 1 FROM checkins WHERE habit_id = ? AND day = ?'
);
const listCheckinDaysStmt = db.prepare(
  'SELECT day FROM checkins WHERE habit_id = ? ORDER BY day DESC'
);

function addCheckin(habitId, day) {
  addCheckinStmt.run(habitId, day);
}

function removeCheckin(habitId, day) {
  removeCheckinStmt.run(habitId, day);
}

function hasCheckin(habitId, day) {
  return !!getCheckinStmt.get(habitId, day);
}

function listCheckinDays(habitId) {
  return listCheckinDaysStmt.all(habitId).map((r) => r.day);
}

module.exports = {
  createUser,
  getUserByUsername,
  getUserById,
  createHabit,
  listHabits,
  getOwnedHabit,
  deleteHabit,
  addCheckin,
  removeCheckin,
  hasCheckin,
  listCheckinDays,
};
