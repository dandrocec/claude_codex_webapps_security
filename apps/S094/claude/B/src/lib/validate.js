'use strict';

const { validateUrlShape } = require('./ssrf');

// Conservative email check; we are validating shape, not deliverability.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

function asString(v) {
  return typeof v === 'string' ? v : '';
}

// True if the string contains C0/C1 control characters (excluding ordinary
// whitespace handling, which callers do via trim()).
function hasControlChars(s) {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

function validateEmail(raw) {
  const email = asString(raw).trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  return { ok: true, value: email };
}

function validatePassword(raw) {
  const pw = asString(raw);
  if (pw.length < 10) {
    return { ok: false, error: 'Password must be at least 10 characters.' };
  }
  if (pw.length > 200) {
    return { ok: false, error: 'Password is too long.' };
  }
  return { ok: true, value: pw };
}

function validateName(raw, label = 'Name') {
  const name = asString(raw).trim();
  if (name.length < 1 || name.length > 80) {
    return { ok: false, error: `${label} must be between 1 and 80 characters.` };
  }
  if (hasControlChars(name)) {
    return { ok: false, error: `${label} contains invalid characters.` };
  }
  return { ok: true, value: name };
}

function validateMethod(raw) {
  const method = asString(raw).trim().toUpperCase() || 'POST';
  if (!ALLOWED_METHODS.has(method)) {
    return { ok: false, error: 'Unsupported HTTP method.' };
  }
  return { ok: true, value: method };
}

// Validates the SHAPE of the target URL (scheme + parse). The network-level
// SSRF range checks happen at request time in the guarded DNS lookup, because
// DNS answers can change between validation and connection.
function validateTargetUrl(raw) {
  const value = asString(raw).trim();
  if (value.length > 2000) {
    return { ok: false, error: 'URL is too long.' };
  }
  try {
    validateUrlShape(value);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  return { ok: true, value };
}

module.exports = {
  validateEmail,
  validatePassword,
  validateName,
  validateMethod,
  validateTargetUrl,
  hasControlChars,
};
