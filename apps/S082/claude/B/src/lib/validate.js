'use strict';

// Small input-validation helpers. All user input is validated against an
// allow-list of shapes before use; rejection messages are safe to display.

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;

function validateUsername(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return USERNAME_RE.test(v) ? v : null;
}

function validatePassword(value) {
  if (typeof value !== 'string') return null;
  // Enforce a reasonable minimum; cap length to avoid bcrypt's 72-byte
  // truncation surprises and abusive payloads.
  if (value.length < 10 || value.length > 200) return null;
  return value;
}

// Parse a positive integer id from a route/body param.
function parseId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

module.exports = { validateUsername, validatePassword, parseId, USERNAME_RE };
