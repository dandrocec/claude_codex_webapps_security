'use strict';

const db = require('./db');

// All queries use parameter placeholders (?) — never string concatenation —
// so user input can never be interpreted as SQL (prevents SQL injection).

const statements = {
  createUser: db.prepare(
    'INSERT INTO users (username, password_hash) VALUES (?, ?)'
  ),
  getUserByUsername: db.prepare(
    'SELECT * FROM users WHERE username = ?'
  ),
  getUserById: db.prepare(
    'SELECT id, username, created_at FROM users WHERE id = ?'
  ),

  insertJob: db.prepare(`
    INSERT INTO jobs (user_id, title, company, location, description)
    VALUES (@user_id, @title, @company, @location, @description)
  `),
  getJobById: db.prepare('SELECT * FROM jobs WHERE id = ?'),
  getAllJobs: db.prepare(`
    SELECT jobs.*, users.username AS poster
    FROM jobs JOIN users ON users.id = jobs.user_id
    ORDER BY jobs.created_at DESC
  `),
  searchJobs: db.prepare(`
    SELECT jobs.*, users.username AS poster
    FROM jobs JOIN users ON users.id = jobs.user_id
    WHERE jobs.title LIKE @term ESCAPE '\\'
       OR jobs.company LIKE @term ESCAPE '\\'
       OR jobs.location LIKE @term ESCAPE '\\'
       OR jobs.description LIKE @term ESCAPE '\\'
    ORDER BY jobs.created_at DESC
  `),
  updateJob: db.prepare(`
    UPDATE jobs
    SET title = @title,
        company = @company,
        location = @location,
        description = @description,
        updated_at = datetime('now')
    WHERE id = @id AND user_id = @user_id
  `),
  deleteJob: db.prepare('DELETE FROM jobs WHERE id = ? AND user_id = ?'),
};

const Users = {
  create(username, passwordHash) {
    const info = statements.createUser.run(username, passwordHash);
    return info.lastInsertRowid;
  },
  findByUsername(username) {
    return statements.getUserByUsername.get(username);
  },
  findById(id) {
    return statements.getUserById.get(id);
  },
};

const Jobs = {
  create({ user_id, title, company, location, description }) {
    const info = statements.insertJob.run({ user_id, title, company, location, description });
    return info.lastInsertRowid;
  },
  findById(id) {
    return statements.getJobById.get(id);
  },
  list(searchTerm) {
    if (searchTerm && searchTerm.trim() !== '') {
      // Escape LIKE wildcards in user input so they are treated literally.
      const escaped = searchTerm.trim().replace(/[\\%_]/g, '\\$&');
      return statements.searchJobs.all({ term: `%${escaped}%` });
    }
    return statements.getAllJobs.all();
  },
  // Returns the number of affected rows; 0 means the job did not belong to the user.
  update(id, userId, fields) {
    const info = statements.updateJob.run({ id, user_id: userId, ...fields });
    return info.changes;
  },
  remove(id, userId) {
    const info = statements.deleteJob.run(id, userId);
    return info.changes;
  },
};

module.exports = { Users, Jobs };
