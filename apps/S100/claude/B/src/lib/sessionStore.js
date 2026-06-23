'use strict';

/**
 * A minimal express-session store backed by the existing better-sqlite3
 * connection, so sessions persist across restarts without pulling in a second
 * SQLite driver. Expired sessions are pruned periodically.
 */

const { db } = require('../db');

module.exports = function createSqliteStore(session) {
  const Store = session.Store;

  class SqliteStore extends Store {
    constructor() {
      super();
      this.getStmt = db.prepare(
        'SELECT sess, expired_at FROM sessions WHERE sid = ?'
      );
      this.upsertStmt = db.prepare(
        `INSERT INTO sessions (sid, sess, expired_at) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess,
                                        expired_at = excluded.expired_at`
      );
      this.destroyStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
      this.touchStmt = db.prepare(
        'UPDATE sessions SET expired_at = ? WHERE sid = ?'
      );
      this.pruneStmt = db.prepare('DELETE FROM sessions WHERE expired_at < ?');

      // Prune expired sessions hourly.
      this._timer = setInterval(() => this.prune(), 60 * 60 * 1000);
      this._timer.unref();
    }

    prune() {
      try {
        this.pruneStmt.run(Date.now());
      } catch {
        /* non-fatal */
      }
    }

    _expiry(sess) {
      const maxAge = sess && sess.cookie && sess.cookie.maxAge;
      return Date.now() + (maxAge || 24 * 60 * 60 * 1000);
    }

    get(sid, cb) {
      try {
        const row = this.getStmt.get(sid);
        if (!row) return cb(null, null);
        if (row.expired_at < Date.now()) {
          this.destroyStmt.run(sid);
          return cb(null, null);
        }
        return cb(null, JSON.parse(row.sess));
      } catch (err) {
        return cb(err);
      }
    }

    set(sid, sess, cb) {
      try {
        this.upsertStmt.run(sid, JSON.stringify(sess), this._expiry(sess));
        return cb && cb(null);
      } catch (err) {
        return cb && cb(err);
      }
    }

    destroy(sid, cb) {
      try {
        this.destroyStmt.run(sid);
        return cb && cb(null);
      } catch (err) {
        return cb && cb(err);
      }
    }

    touch(sid, sess, cb) {
      try {
        this.touchStmt.run(this._expiry(sess), sid);
        return cb && cb(null);
      } catch (err) {
        return cb && cb(err);
      }
    }
  }

  return new SqliteStore();
};
