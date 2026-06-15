'use strict';

// A tiny sample of widely-leaked passwords. A production app would check
// against a large breach corpus (e.g. Have I Been Pwned k-anonymity API).
const COMMON_PASSWORDS = new Set([
  'password', 'password1', '123456', '12345678', '123456789', 'qwerty',
  'qwerty123', 'abc123', 'letmein', 'iloveyou', 'admin', 'welcome',
  'monkey', 'dragon', '111111', '000000', 'passw0rd', 'football',
]);

const MAX_LENGTH = 200; // Bound work to avoid abusive payloads (DoS).

/**
 * Rate a candidate password purely on length and character variety.
 * Pure function: no I/O, no storage. Returns a structured result so the
 * caller decides how to render it (with output encoding).
 *
 * @param {string} password
 * @returns {{ rating: 'weak'|'medium'|'strong', score: number, maxScore: number, feedback: string[] }}
 */
function evaluatePassword(password) {
  const pw = typeof password === 'string' ? password : '';
  const length = pw.length;
  const feedback = [];
  let score = 0;

  // --- Length (0–2 points) ---
  if (length >= 12) {
    score += 2;
  } else if (length >= 8) {
    score += 1;
    feedback.push('Increase length to 12+ characters for a stronger password.');
  } else {
    feedback.push('Use at least 8 characters (12 or more is recommended).');
  }

  // --- Character variety (0–4 points) ---
  const hasLower = /[a-z]/.test(pw);
  const hasUpper = /[A-Z]/.test(pw);
  const hasDigit = /[0-9]/.test(pw);
  const hasSymbol = /[^A-Za-z0-9]/.test(pw);

  score += [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;

  if (!hasLower) feedback.push('Add lowercase letters (a–z).');
  if (!hasUpper) feedback.push('Add uppercase letters (A–Z).');
  if (!hasDigit) feedback.push('Add numbers (0–9).');
  if (!hasSymbol) feedback.push('Add symbols (e.g. ! @ # $ %).');

  const maxScore = 6;

  // --- Penalties for obviously weak shapes ---
  if (length > 0 && /^(.)\1+$/.test(pw)) {
    feedback.push('Avoid repeating a single character.');
    score = Math.min(score, 1);
  }
  if (COMMON_PASSWORDS.has(pw.toLowerCase())) {
    feedback.push('This is a commonly used password — choose something unique.');
    score = 0;
  }

  score = Math.max(0, Math.min(score, maxScore));

  // --- Map score to rating ---
  let rating;
  if (score <= 2) {
    rating = 'weak';
  } else if (score <= 4) {
    rating = 'medium';
  } else {
    rating = 'strong';
  }

  if (rating === 'strong' && feedback.length === 0) {
    feedback.push('Great password! Consider a password manager to store it safely.');
  }

  return { rating, score, maxScore, feedback };
}

module.exports = { evaluatePassword, MAX_LENGTH, COMMON_PASSWORDS };
