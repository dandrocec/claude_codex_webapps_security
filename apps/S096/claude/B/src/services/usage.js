'use strict';

const db = require('../db');
const config = require('../config');

const statements = {
  log: db.prepare(`
    INSERT INTO usage_logs (key_id, ts, method, path, status, duration_ms)
    VALUES (@key_id, @ts, @method, @path, @status, @duration_ms)
  `),
  countInWindow: db.prepare(`
    SELECT COUNT(*) AS n FROM usage_logs WHERE key_id = ? AND ts > ?
  `),
  // Aggregate stats for the dashboard, scoped to a single user's keys.
  summaryForUser: db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN u.ts > ? THEN 1 ELSE 0 END), 0) AS last_24h,
      COALESCE(SUM(CASE WHEN u.status >= 200 AND u.status < 400 THEN 1 ELSE 0 END), 0) AS ok,
      COALESCE(SUM(CASE WHEN u.status >= 400 THEN 1 ELSE 0 END), 0) AS errors
    FROM usage_logs u
    JOIN api_keys k ON k.id = u.key_id
    WHERE k.user_id = ?
  `),
  perKeyForUser: db.prepare(`
    SELECT k.id AS key_id, COUNT(u.id) AS total,
           MAX(u.ts) AS last_used
    FROM api_keys k
    LEFT JOIN usage_logs u ON u.key_id = k.id
    WHERE k.user_id = ?
    GROUP BY k.id
  `),
  recentForUser: db.prepare(`
    SELECT u.ts, u.method, u.path, u.status, u.duration_ms, k.key_prefix
    FROM usage_logs u
    JOIN api_keys k ON k.id = u.key_id
    WHERE k.user_id = ?
    ORDER BY u.ts DESC
    LIMIT 25
  `),
};

function logRequest({ keyId, method, path, status, durationMs }) {
  statements.log.run({
    key_id: keyId,
    ts: Date.now(),
    method,
    path,
    status,
    duration_ms: durationMs,
  });
}

function countRecent(keyId, windowMs = config.rateWindowMs) {
  const since = Date.now() - windowMs;
  return statements.countInWindow.get(keyId, since).n;
}

function dashboardData(userId) {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const summary = statements.summaryForUser.get(dayAgo, userId);
  const perKey = statements.perKeyForUser.all(userId);
  const recent = statements.recentForUser.all(userId);
  const perKeyMap = new Map(perKey.map((r) => [r.key_id, r]));
  return { summary, perKeyMap, recent };
}

module.exports = { logRequest, countRecent, dashboardData };
