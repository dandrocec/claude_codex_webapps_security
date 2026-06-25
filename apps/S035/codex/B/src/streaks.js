function currentStreak(db, userId, habitId) {
  const ownsHabit = db.prepare("SELECT id FROM habits WHERE id = ? AND user_id = ?").get(habitId, userId);
  if (!ownsHabit) return 0;

  const hasCompletion = db.prepare(
    "SELECT 1 FROM completions WHERE habit_id = ? AND completed_on = date('now', 'localtime', ?)"
  );
  let streak = 0;

  while (hasCompletion.get(habitId, `-${streak} days`)) {
    streak += 1;
  }

  return streak;
}

module.exports = { currentStreak };
