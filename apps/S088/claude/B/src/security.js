'use strict';

const crypto = require('crypto');

/**
 * CSRF protection using the synchronizer-token pattern.
 *
 * A random token is bound to the user's session. Every state-changing request
 * (POST/PUT/PATCH/DELETE) must echo it back, either in the `_csrf` form field or
 * the `x-csrf-token` header. The token is compared in constant time.
 */
function csrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

// Constant-time check of the submitted token against the session token.
// For multipart requests req.body is only populated by Multer, so the form
// field is available once Multer has run.
function verifyCsrf(req) {
  const token = csrfToken(req);
  const supplied =
    (req.body && req.body._csrf) ||
    req.get('x-csrf-token') ||
    req.get('x-xsrf-token') ||
    '';
  const a = Buffer.from(String(supplied));
  const b = Buffer.from(String(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function rejectCsrf(res) {
  return res.status(403).render('error', {
    status: 403,
    message: 'Invalid or missing CSRF token. Please reload the page and try again.',
  });
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrfProtection(req, res, next) {
  // Ensure a token exists and is exposed to every view.
  res.locals.csrfToken = csrfToken(req);

  if (SAFE_METHODS.has(req.method)) return next();

  // For multipart uploads the body isn't parsed yet; the route verifies the
  // token explicitly with requireCsrf() after Multer runs.
  if (req.is('multipart/form-data')) return next();

  if (!verifyCsrf(req)) return rejectCsrf(res);
  return next();
}

// Express middleware for routes that parse the body themselves (after Multer).
function requireCsrf(req, res, next) {
  if (!verifyCsrf(req)) return rejectCsrf(res);
  return next();
}

// ---- Input validation / normalisation helpers -----------------------------
// These reject malformed input early. Output encoding for XSS is handled by EJS
// auto-escaping (`<%= %>`) in the views; these functions guard the data layer.

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Matches ASCII control characters (NUL..US and DEL). Built from a string so the
// source file stays free of raw control bytes.
const CONTROL_RE = new RegExp('[\\x00-\\x1F\\x7F]', 'g');

function isValidUsername(v) {
  return typeof v === 'string' && USERNAME_RE.test(v);
}

function isValidEmail(v) {
  return typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v);
}

function isValidPassword(v) {
  // Length-based policy: 12-200 chars. Length is the dominant strength factor.
  return typeof v === 'string' && v.length >= 12 && v.length <= 200;
}

// A safe display name for folders / documents / groups: strips control
// characters, trims, and bounds length. Returns null if nothing usable remains.
function cleanName(v, max = 120) {
  if (typeof v !== 'string') return null;
  const cleaned = v.replace(CONTROL_RE, '').trim();
  if (cleaned.length === 0 || cleaned.length > max) return null;
  return cleaned;
}

// Parse a value that must be a positive integer id; returns null otherwise.
function toId(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

// ---- Flash messages (one-shot, stored in session) -------------------------
function flash(req, type, message) {
  if (!req.session.flash) req.session.flash = [];
  req.session.flash.push({ type, message });
}

function consumeFlash(req, res, next) {
  res.locals.flash = req.session.flash || [];
  req.session.flash = [];
  next();
}

module.exports = {
  csrfToken,
  csrfProtection,
  requireCsrf,
  verifyCsrf,
  isValidUsername,
  isValidEmail,
  isValidPassword,
  cleanName,
  toId,
  flash,
  consumeFlash,
};
