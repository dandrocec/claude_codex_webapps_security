'use strict';

const db = require('../db');

// Every query is scoped by user_id in addition to the row id. This enforces
// access control at the data layer and prevents IDOR: a user can never read or
// mutate a row that is not theirs, even if they guess another row's id.

const insertStmt = db.prepare(`
  INSERT INTO expenses (user_id, amount, category, spent_on, note)
  VALUES (@user_id, @amount, @category, @spent_on, @note)
`);

const listForMonthStmt = db.prepare(`
  SELECT id, amount, category, spent_on, note
  FROM expenses
  WHERE user_id = ? AND spent_on >= ? AND spent_on < ?
  ORDER BY spent_on DESC, id DESC
`);

const monthlyTotalStmt = db.prepare(`
  SELECT COALESCE(SUM(amount), 0) AS total
  FROM expenses
  WHERE user_id = ? AND spent_on >= ? AND spent_on < ?
`);

const byIdStmt = db.prepare(
  'SELECT id, amount, category, spent_on, note FROM expenses WHERE id = ? AND user_id = ?'
);

const updateStmt = db.prepare(`
  UPDATE expenses
  SET amount = @amount, category = @category, spent_on = @spent_on, note = @note
  WHERE id = @id AND user_id = @user_id
`);

const deleteStmt = db.prepare('DELETE FROM expenses WHERE id = ? AND user_id = ?');

function create(userId, { amount, category, spentOn, note }) {
  const info = insertStmt.run({
    user_id: userId,
    amount,
    category,
    spent_on: spentOn,
    note,
  });
  return info.lastInsertRowid;
}

function listForMonth(userId, monthStart, nextMonthStart) {
  return listForMonthStmt.all(userId, monthStart, nextMonthStart);
}

function monthlyTotal(userId, monthStart, nextMonthStart) {
  return monthlyTotalStmt.get(userId, monthStart, nextMonthStart).total;
}

function findById(id, userId) {
  return byIdStmt.get(id, userId);
}

// Returns true only if a row owned by userId was updated.
function update(id, userId, { amount, category, spentOn, note }) {
  const info = updateStmt.run({
    id,
    user_id: userId,
    amount,
    category,
    spent_on: spentOn,
    note,
  });
  return info.changes > 0;
}

// Returns true only if a row owned by userId was deleted.
function remove(id, userId) {
  return deleteStmt.run(id, userId).changes > 0;
}

module.exports = {
  create,
  listForMonth,
  monthlyTotal,
  findById,
  update,
  remove,
};
