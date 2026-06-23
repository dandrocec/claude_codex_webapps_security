'use strict';

// All monetary values are stored as integer cents to avoid floating-point errors.

function centsToDisplay(cents) {
  const n = Number(cents) || 0;
  return (n / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

// Parse a user-supplied dollar amount (e.g. "25", "25.50") into integer cents.
// Returns null if the value is not a valid positive amount.
function dollarsToCents(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const str = String(value).trim();
  // Allow an optional leading "$", digits, and up to two decimal places.
  if (!/^\$?\d{1,9}(\.\d{1,2})?$/.test(str)) return null;
  const cents = Math.round(parseFloat(str.replace('$', '')) * 100);
  if (!Number.isFinite(cents) || cents <= 0) return null;
  return cents;
}

module.exports = { centsToDisplay, dollarsToCents };
