'use strict';

const { db } = require('../db');

const insertStmt = db.prepare(
  `INSERT INTO services (owner_id, name, repo_url, description, steps)
   VALUES (@owner_id, @name, @repo_url, @description, @steps)`
);
const byIdStmt = db.prepare('SELECT * FROM services WHERE id = ?');
const allStmt = db.prepare(
  `SELECT s.*, u.username AS owner_username
     FROM services s JOIN users u ON u.id = s.owner_id
    ORDER BY s.created_at DESC`
);
const byOwnerStmt = db.prepare(
  'SELECT * FROM services WHERE owner_id = ? ORDER BY created_at DESC'
);
const updateStmt = db.prepare(
  `UPDATE services
      SET name = @name, repo_url = @repo_url,
          description = @description, steps = @steps
    WHERE id = @id`
);
const deleteStmt = db.prepare('DELETE FROM services WHERE id = ?');

function create({ ownerId, name, repoUrl, description, steps }) {
  const info = insertStmt.run({
    owner_id: ownerId,
    name,
    repo_url: repoUrl || null,
    description: description || null,
    steps: JSON.stringify(steps || []),
  });
  return findById(info.lastInsertRowid);
}

function findById(id) {
  const row = byIdStmt.get(id);
  if (row) row.steps = safeParseSteps(row.steps);
  return row;
}

function listAll() {
  return allStmt.all().map((row) => {
    row.steps = safeParseSteps(row.steps);
    return row;
  });
}

function listByOwner(ownerId) {
  return byOwnerStmt.all(ownerId).map((row) => {
    row.steps = safeParseSteps(row.steps);
    return row;
  });
}

function update(id, { name, repoUrl, description, steps }) {
  updateStmt.run({
    id,
    name,
    repo_url: repoUrl || null,
    description: description || null,
    steps: JSON.stringify(steps || []),
  });
  return findById(id);
}

function remove(id) {
  deleteStmt.run(id);
}

function safeParseSteps(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

module.exports = {
  create,
  findById,
  listAll,
  listByOwner,
  update,
  remove,
};
