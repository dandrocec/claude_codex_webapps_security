'use strict';

/**
 * Rate a candidate password's strength based on length and character variety.
 *
 * Scoring:
 *   +1 for length >= 8, +1 more for length >= 12
 *   +1 each for lowercase, uppercase, digit, and symbol presence
 *
 * The score (0-6) maps to weak / medium / strong, and we collect short,
 * actionable feedback on what's missing.
 *
 * @param {string} password
 * @returns {{ rating: string, score: number, feedback: string[] }}
 */
function ratePassword(password) {
  const pwd = typeof password === 'string' ? password : '';

  const checks = {
    lower: /[a-z]/.test(pwd),
    upper: /[A-Z]/.test(pwd),
    digit: /[0-9]/.test(pwd),
    symbol: /[^A-Za-z0-9]/.test(pwd),
  };

  let score = 0;
  if (pwd.length >= 8) score += 1;
  if (pwd.length >= 12) score += 1;
  if (checks.lower) score += 1;
  if (checks.upper) score += 1;
  if (checks.digit) score += 1;
  if (checks.symbol) score += 1;

  const feedback = [];
  if (pwd.length === 0) {
    feedback.push('Enter a password to check.');
  } else {
    if (pwd.length < 8) {
      feedback.push('Use at least 8 characters (12+ is stronger).');
    } else if (pwd.length < 12) {
      feedback.push('Lengthen it to 12+ characters for extra strength.');
    }
    if (!checks.lower) feedback.push('Add lowercase letters (a-z).');
    if (!checks.upper) feedback.push('Add uppercase letters (A-Z).');
    if (!checks.digit) feedback.push('Add digits (0-9).');
    if (!checks.symbol) feedback.push('Add symbols (e.g. !@#$%).');
  }

  let rating;
  if (pwd.length === 0 || score <= 2) {
    rating = 'weak';
  } else if (score <= 4) {
    rating = 'medium';
  } else {
    rating = 'strong';
  }

  if (rating === 'strong' && feedback.length === 0) {
    feedback.push('Great password!');
  }

  return { rating, score, feedback };
}

module.exports = { ratePassword };
