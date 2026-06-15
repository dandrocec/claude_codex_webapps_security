'use strict';

// Helpers for working with calendar days as 'YYYY-MM-DD' strings in local time.

function toISODay(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayISO() {
  return toISODay(new Date());
}

function addDaysISO(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return toISODay(dt);
}

// A valid 'YYYY-MM-DD' that represents a real calendar date.
function isValidISODay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return (
    dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
  );
}

// Current streak: consecutive days with a check-in ending today or yesterday.
// (Yesterday still counts so a streak isn't "lost" until a full day is missed.)
function currentStreak(checkinDays) {
  const set = new Set(checkinDays);
  const today = todayISO();
  const yesterday = addDaysISO(today, -1);

  let cursor;
  if (set.has(today)) {
    cursor = today;
  } else if (set.has(yesterday)) {
    cursor = yesterday;
  } else {
    return 0;
  }

  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor = addDaysISO(cursor, -1);
  }
  return streak;
}

module.exports = {
  toISODay,
  todayISO,
  addDaysISO,
  isValidISODay,
  currentStreak,
};
