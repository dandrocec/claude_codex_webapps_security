'use strict';

// Small, dependency-free input validators. Each returns either a normalised
// value or throws nothing — callers check the returned { ok, value, error }.

const USERNAME_RE = /^[A-Za-z0-9_]{3,32}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;

function validateUsername(raw) {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Username is required.' };
  }
  const value = raw.trim();
  if (!USERNAME_RE.test(value)) {
    return {
      ok: false,
      error:
        'Username must be 3–32 characters: letters, numbers, or underscore.',
    };
  }
  return { ok: true, value };
}

function validatePassword(raw) {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Password is required.' };
  }
  if (raw.length < PASSWORD_MIN || raw.length > PASSWORD_MAX) {
    return {
      ok: false,
      error: `Password must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters.`,
    };
  }
  return { ok: true, value: raw };
}

/** Parses a positive integer id from a route parameter. */
function parseId(raw) {
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,15}$/.test(raw)) {
    return null;
  }
  return Number.parseInt(raw, 10);
}

module.exports = { validateUsername, validatePassword, parseId };
