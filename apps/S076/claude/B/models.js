'use strict';

// All database access goes through prepared statements with bound
// parameters (the "?" placeholders) — this prevents SQL injection because
// user input is never concatenated into SQL text.

const db = require('./db');

const stmts = {
  createUser: db.prepare(
    'INSERT INTO users (username, password_hash) VALUES (?, ?)'
  ),
  findUserByName: db.prepare(
    'SELECT id, username, password_hash FROM users WHERE username = ?'
  ),
  findUserById: db.prepare('SELECT id, username FROM users WHERE id = ?'),

  createRoom: db.prepare(
    'INSERT INTO rooms (name, created_by) VALUES (?, ?)'
  ),
  findRoomByName: db.prepare('SELECT id, name FROM rooms WHERE name = ?'),
  findRoomById: db.prepare(
    'SELECT id, name, created_by FROM rooms WHERE id = ?'
  ),
  listRooms: db.prepare(`
    SELECT r.id, r.name, u.username AS creator, r.created_at,
           (SELECT COUNT(*) FROM messages m WHERE m.room_id = r.id) AS message_count
    FROM rooms r
    JOIN users u ON u.id = r.created_by
    ORDER BY r.name COLLATE NOCASE ASC
  `),

  createMessage: db.prepare(
    'INSERT INTO messages (room_id, user_id, body) VALUES (?, ?, ?)'
  ),
  listMessages: db.prepare(`
    SELECT m.id, m.body, m.created_at, m.user_id, u.username AS author
    FROM messages m
    JOIN users u ON u.id = m.user_id
    WHERE m.room_id = ?
    ORDER BY m.id ASC
    LIMIT 500
  `),
  findMessageById: db.prepare(
    'SELECT id, room_id, user_id FROM messages WHERE id = ?'
  ),
  deleteMessage: db.prepare('DELETE FROM messages WHERE id = ?'),
};

module.exports = {
  createUser(username, passwordHash) {
    const info = stmts.createUser.run(username, passwordHash);
    return { id: info.lastInsertRowid, username };
  },
  findUserByName: (username) => stmts.findUserByName.get(username),
  findUserById: (id) => stmts.findUserById.get(id),

  createRoom(name, createdBy) {
    const info = stmts.createRoom.run(name, createdBy);
    return { id: info.lastInsertRowid, name };
  },
  findRoomByName: (name) => stmts.findRoomByName.get(name),
  findRoomById: (id) => stmts.findRoomById.get(id),
  listRooms: () => stmts.listRooms.all(),

  createMessage(roomId, userId, body) {
    const info = stmts.createMessage.run(roomId, userId, body);
    return info.lastInsertRowid;
  },
  listMessages: (roomId) => stmts.listMessages.all(roomId),
  findMessageById: (id) => stmts.findMessageById.get(id),
  deleteMessage: (id) => stmts.deleteMessage.run(id),
};
