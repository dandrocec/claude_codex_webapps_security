'use strict';

const { Store } = require('express-session');
const db = require('./db');

// A tiny session store backed by the same better-sqlite3 connection, so the
// app needs only one native dependency (no extra session-store package).
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid     TEXT PRIMARY KEY,
    expires INTEGER NOT NULL,
    data    TEXT NOT NULL
  );
`);

const stmts = {
  get: db.prepare('SELECT data, expires FROM sessions WHERE sid = ?'),
  set: db.prepare(`
    INSERT INTO sessions (sid, expires, data) VALUES (@sid, @expires, @data)
    ON CONFLICT (sid) DO UPDATE SET expires = @expires, data = @data
  `),
  destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
  clearExpired: db.prepare('DELETE FROM sessions WHERE expires <= ?'),
};

function expiresAt(session) {
  const maxAge = session.cookie && session.cookie.maxAge;
  return Date.now() + (maxAge || 1000 * 60 * 60 * 24); // default 1 day
}

class SqliteStore extends Store {
  get(sid, cb) {
    try {
      const row = stmts.get.get(sid);
      if (!row) return cb(null, null);
      if (row.expires <= Date.now()) {
        stmts.destroy.run(sid);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.data));
    } catch (err) {
      cb(err);
    }
  }

  set(sid, session, cb) {
    try {
      stmts.set.run({
        sid,
        expires: expiresAt(session),
        data: JSON.stringify(session),
      });
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      stmts.destroy.run(sid);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  // Refresh expiry on activity so active sessions don't expire mid-use.
  touch(sid, session, cb) {
    this.set(sid, session, cb);
  }
}

// Periodically purge expired sessions.
setInterval(() => {
  try {
    stmts.clearExpired.run(Date.now());
  } catch (_) {
    /* ignore */
  }
}, 1000 * 60 * 60).unref();

module.exports = SqliteStore;
