'use strict';

/**
 * Tiny JSON-file backed store. No native dependencies, so the app runs
 * anywhere Node does. Writes are persisted atomically on every change.
 *
 * Shape of the data file:
 *   { "users": [...], "tasks": [...], "seq": { "users": 0, "tasks": 0 } }
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

const EMPTY = { users: [], tasks: [], seq: { users: 0, tasks: 0 } };

let db = EMPTY;

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    db = JSON.parse(raw);
    // Make sure all expected keys exist even on older files.
    db.users ||= [];
    db.tasks ||= [];
    db.seq ||= { users: 0, tasks: 0 };
  } catch (err) {
    if (err.code === 'ENOENT') {
      db = structuredClone(EMPTY);
      persist();
    } else {
      throw err;
    }
  }
}

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE); // atomic replace
}

function nextId(table) {
  db.seq[table] += 1;
  return db.seq[table];
}

// ---- Users -----------------------------------------------------------------

function findUserByUsername(username) {
  return db.users.find((u) => u.username === username);
}

function findUserById(id) {
  return db.users.find((u) => u.id === id);
}

function createUser({ username, passwordHash }) {
  const user = {
    id: nextId('users'),
    username,
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  persist();
  return user;
}

// ---- Tasks -----------------------------------------------------------------

function listTasks(userId) {
  return db.tasks.filter((t) => t.userId === userId);
}

function findTask(userId, id) {
  return db.tasks.find((t) => t.id === id && t.userId === userId);
}

function createTask(userId, { title, description = '', done = false }) {
  const now = new Date().toISOString();
  const task = {
    id: nextId('tasks'),
    userId,
    title,
    description,
    done: Boolean(done),
    createdAt: now,
    updatedAt: now,
  };
  db.tasks.push(task);
  persist();
  return task;
}

function updateTask(userId, id, patch) {
  const task = findTask(userId, id);
  if (!task) return null;
  if (patch.title !== undefined) task.title = patch.title;
  if (patch.description !== undefined) task.description = patch.description;
  if (patch.done !== undefined) task.done = Boolean(patch.done);
  task.updatedAt = new Date().toISOString();
  persist();
  return task;
}

function deleteTask(userId, id) {
  const idx = db.tasks.findIndex((t) => t.id === id && t.userId === userId);
  if (idx === -1) return false;
  db.tasks.splice(idx, 1);
  persist();
  return true;
}

load();

module.exports = {
  findUserByUsername,
  findUserById,
  createUser,
  listTasks,
  findTask,
  createTask,
  updateTask,
  deleteTask,
};
