'use strict';

const { db } = require('../db');

const insertStmt = db.prepare(
  `INSERT INTO deployments (service_id, triggered_by, status)
   VALUES (?, ?, 'running')`
);
const byIdStmt = db.prepare('SELECT * FROM deployments WHERE id = ?');
const byServiceStmt = db.prepare(
  `SELECT d.*, u.username AS triggered_by_username
     FROM deployments d
     LEFT JOIN users u ON u.id = d.triggered_by
    WHERE d.service_id = ?
    ORDER BY d.id DESC
    LIMIT 50`
);
const setStatusStmt = db.prepare(
  `UPDATE deployments
      SET status = ?, finished_at = datetime('now')
    WHERE id = ?`
);

const insertLogStmt = db.prepare(
  `INSERT INTO logs (deployment_id, seq, stream, line)
   VALUES (?, ?, ?, ?)`
);
const logsStmt = db.prepare(
  'SELECT seq, stream, line FROM logs WHERE deployment_id = ? ORDER BY seq ASC'
);

function create(serviceId, userId) {
  const info = insertStmt.run(serviceId, userId);
  return findById(info.lastInsertRowid);
}

function findById(id) {
  return byIdStmt.get(id);
}

function listByService(serviceId) {
  return byServiceStmt.all(serviceId);
}

function setStatus(id, status) {
  setStatusStmt.run(status, id);
}

function appendLog(deploymentId, seq, stream, line) {
  insertLogStmt.run(deploymentId, seq, stream, line);
}

function getLogs(deploymentId) {
  return logsStmt.all(deploymentId);
}

module.exports = {
  create,
  findById,
  listByService,
  setStatus,
  appendLog,
  getLogs,
};
