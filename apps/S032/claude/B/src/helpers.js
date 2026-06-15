'use strict';

// Returns { monthStart, nextMonthStart, label } for a given "YYYY-MM" string,
// falling back to the current month when input is missing or malformed.
function resolveMonth(monthParam) {
  let year;
  let month; // 1-12
  const match = /^(\d{4})-(\d{2})$/.exec(monthParam || '');
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
  }
  if (!year || !month || month < 1 || month > 12) {
    const now = new Date();
    year = now.getUTCFullYear();
    month = now.getUTCMonth() + 1;
  }

  const pad = (n) => String(n).padStart(2, '0');
  const monthStart = `${year}-${pad(month)}-01`;

  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextMonthStart = `${nextYear}-${pad(nextMonth)}-01`;

  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return {
    value: `${year}-${pad(month)}`,
    monthStart,
    nextMonthStart,
    label,
  };
}

// Convert integer cents to a display string like "12.34".
function formatAmount(cents) {
  return (cents / 100).toFixed(2);
}

module.exports = { resolveMonth, formatAmount };
