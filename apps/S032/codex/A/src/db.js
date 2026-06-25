const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'expenses.sqlite'));
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    category TEXT NOT NULL,
    expense_date TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_expenses_user_date
    ON expenses(user_id, expense_date);
`);

function findUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function createUser(username, passwordHash) {
  const result = db
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, passwordHash);
  return db.prepare('SELECT id, username FROM users WHERE id = ?').get(result.lastInsertRowid);
}

function listExpenses(userId, month) {
  return db
    .prepare(
      `SELECT *
       FROM expenses
       WHERE user_id = ?
         AND strftime('%Y-%m', expense_date) = ?
       ORDER BY expense_date DESC, id DESC`
    )
    .all(userId, month);
}

function monthlyTotal(userId, month) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM expenses
       WHERE user_id = ?
         AND strftime('%Y-%m', expense_date) = ?`
    )
    .get(userId, month);
  return row.total;
}

function getExpense(id, userId) {
  return db.prepare('SELECT * FROM expenses WHERE id = ? AND user_id = ?').get(id, userId);
}

function createExpense(userId, expense) {
  return db
    .prepare(
      `INSERT INTO expenses (user_id, amount, category, expense_date, note)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(userId, expense.amount, expense.category, expense.expenseDate, expense.note);
}

function updateExpense(id, userId, expense) {
  return db
    .prepare(
      `UPDATE expenses
       SET amount = ?, category = ?, expense_date = ?, note = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`
    )
    .run(expense.amount, expense.category, expense.expenseDate, expense.note, id, userId);
}

function deleteExpense(id, userId) {
  return db.prepare('DELETE FROM expenses WHERE id = ? AND user_id = ?').run(id, userId);
}

module.exports = {
  findUserByUsername,
  createUser,
  listExpenses,
  monthlyTotal,
  getExpense,
  createExpense,
  updateExpense,
  deleteExpense
};
