'use strict';

// Tags are stored as a normalised, comma-separated string.
// These helpers keep that representation consistent everywhere.

function normalizeTags(raw) {
  if (!raw) return '';
  return Array.from(
    new Set(
      String(raw)
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        // keep tags reasonable: letters, numbers, dash, underscore, spaces
        .map((t) => t.replace(/[^a-z0-9_\- ]/gi, ''))
        .filter(Boolean)
    )
  )
    .slice(0, 25) // cap the number of tags
    .join(',');
}

function tagsToArray(tagString) {
  if (!tagString) return [];
  return tagString.split(',').filter(Boolean);
}

// Distinct, sorted list of every tag the user has used (for the filter UI).
function collectTags(bookmarks) {
  const set = new Set();
  for (const b of bookmarks) {
    for (const t of tagsToArray(b.tags)) set.add(t);
  }
  return Array.from(set).sort();
}

module.exports = { normalizeTags, tagsToArray, collectTags };
