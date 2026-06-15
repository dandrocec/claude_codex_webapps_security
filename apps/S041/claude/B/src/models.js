'use strict';

// All queries here use parameter placeholders (?) — never string concatenation —
// so user-supplied values can never alter the SQL structure (SQLi prevention).

const db = require('./db');

const Users = {
  findByUsername(username) {
    return db
      .prepare('SELECT id, username, password_hash FROM users WHERE username = ?')
      .get(username);
  },
  findById(id) {
    return db.prepare('SELECT id, username FROM users WHERE id = ?').get(id);
  },
};

const Faqs = {
  // Public listing: every published FAQ, grouped/sorted for display.
  allForPublic() {
    return db
      .prepare(
        `SELECT id, question, answer, category, sort_order
           FROM faqs
          ORDER BY category COLLATE NOCASE ASC, sort_order ASC, id ASC`
      )
      .all();
  },

  // Admin listing scoped to a single owner (access control / IDOR prevention).
  allForOwner(authorId) {
    return db
      .prepare(
        `SELECT id, question, answer, category, sort_order
           FROM faqs
          WHERE author_id = ?
          ORDER BY category COLLATE NOCASE ASC, sort_order ASC, id ASC`
      )
      .all(authorId);
  },

  // Fetch a single FAQ but ONLY if it belongs to the requesting owner.
  findOwned(id, authorId) {
    return db
      .prepare(
        `SELECT id, question, answer, category, sort_order, author_id
           FROM faqs
          WHERE id = ? AND author_id = ?`
      )
      .get(id, authorId);
  },

  create({ question, answer, category, authorId }) {
    // Place the new item at the end of its category for that owner.
    const { nextOrder } = db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS nextOrder
           FROM faqs
          WHERE author_id = ? AND category = ?`
      )
      .get(authorId, category);

    return db
      .prepare(
        `INSERT INTO faqs (question, answer, category, sort_order, author_id)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(question, answer, category, nextOrder, authorId);
  },

  // Update only when the row is owned by authorId; returns affected row count.
  update(id, authorId, { question, answer, category }) {
    return db
      .prepare(
        `UPDATE faqs
            SET question = ?, answer = ?, category = ?, updated_at = datetime('now')
          WHERE id = ? AND author_id = ?`
      )
      .run(question, answer, category, id, authorId);
  },

  delete(id, authorId) {
    return db
      .prepare('DELETE FROM faqs WHERE id = ? AND author_id = ?')
      .run(id, authorId);
  },

  // Move an owned FAQ up or down within the full owner ordering by swapping
  // sort positions with its neighbour. Runs in a transaction for consistency.
  reorder(id, authorId, direction) {
    const move = db.transaction(() => {
      const current = db
        .prepare(
          `SELECT id, category, sort_order
             FROM faqs WHERE id = ? AND author_id = ?`
        )
        .get(id, authorId);
      if (!current) return false;

      const comparator = direction === 'up' ? '<' : '>';
      const order = direction === 'up' ? 'DESC' : 'ASC';
      const neighbour = db
        .prepare(
          `SELECT id, sort_order
             FROM faqs
            WHERE author_id = ? AND category = ? AND sort_order ${comparator} ?
            ORDER BY sort_order ${order}
            LIMIT 1`
        )
        .get(authorId, current.category, current.sort_order);
      if (!neighbour) return false;

      const upd = db.prepare(
        'UPDATE faqs SET sort_order = ? WHERE id = ? AND author_id = ?'
      );
      upd.run(neighbour.sort_order, current.id, authorId);
      upd.run(current.sort_order, neighbour.id, authorId);
      return true;
    });
    return move();
  },
};

module.exports = { Users, Faqs };
