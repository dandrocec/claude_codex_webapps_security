'use strict';

// All queries use parameterised statements (never string concatenation),
// which prevents SQL injection.

const db = require('./db');

const users = {
  create: db.prepare(
    `INSERT INTO users (username, email, password_hash) VALUES (@username, @email, @password_hash)`
  ),
  byId: db.prepare(`SELECT * FROM users WHERE id = ?`),
  byUsername: db.prepare(`SELECT * FROM users WHERE username = ? COLLATE NOCASE`),
  byEmail: db.prepare(`SELECT * FROM users WHERE email = ? COLLATE NOCASE`),
  updateBio: db.prepare(`UPDATE users SET bio = @bio WHERE id = @id`),
};

const posts = {
  create: db.prepare(`INSERT INTO posts (user_id, content) VALUES (@user_id, @content)`),
  byId: db.prepare(`SELECT * FROM posts WHERE id = ?`),
  delete: db.prepare(`DELETE FROM posts WHERE id = @id AND user_id = @user_id`),
  byUser: db.prepare(
    `SELECT p.*, u.username
       FROM posts p JOIN users u ON u.id = p.user_id
      WHERE p.user_id = ?
      ORDER BY p.created_at DESC, p.id DESC`
  ),
  // Feed: the user's own posts plus everyone they follow.
  feed: db.prepare(
    `SELECT p.*, u.username
       FROM posts p
       JOIN users u ON u.id = p.user_id
      WHERE p.user_id = @uid
         OR p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = @uid)
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT 100`
  ),
};

const follows = {
  follow: db.prepare(
    `INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (@follower_id, @followee_id)`
  ),
  unfollow: db.prepare(
    `DELETE FROM follows WHERE follower_id = @follower_id AND followee_id = @followee_id`
  ),
  isFollowing: db.prepare(
    `SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?`
  ),
  followerCount: db.prepare(`SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?`),
  followingCount: db.prepare(`SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?`),
};

module.exports = { users, posts, follows };
