'use strict';

// Content-based file-type detection.
//
// We DO NOT trust the client-supplied filename or Content-Type header. Instead
// we inspect the leading bytes ("magic numbers") of the uploaded buffer and
// only accept an explicit allow-list of types. A plain-text file has no magic
// number, so it is validated structurally (valid UTF-8, no control bytes).

/**
 * @typedef {{ ext: string, mime: string }} DetectedType
 */

/** Compares a slice of `buf` against a byte signature. */
function startsWith(buf, signature, offset = 0) {
  if (buf.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (buf[offset + i] !== signature[i]) return false;
  }
  return true;
}

function isWebp(buf) {
  // "RIFF" .... "WEBP"
  return (
    buf.length >= 12 &&
    startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && // RIFF
    startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8) // WEBP
  );
}

/**
 * Returns true if the buffer looks like real, human-readable UTF-8 text:
 * decodes cleanly and contains no NUL/control bytes other than common
 * whitespace (tab, LF, CR).
 */
function looksLikeText(buf) {
  if (buf.length === 0) return true;
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    for (const ch of decoded) {
      const code = ch.codePointAt(0);
      const isAllowedControl = code === 0x09 || code === 0x0a || code === 0x0d;
      if (code < 0x20 && !isAllowedControl) return false;
    }
    return true;
  } catch {
    return false; // not valid UTF-8
  }
}

/**
 * Inspect a buffer and return its detected type, or null if it is not on the
 * allow-list.
 * @param {Buffer} buf
 * @returns {DetectedType | null}
 */
function detect(buf) {
  if (!buf || buf.length === 0) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ext: '.png', mime: 'image/png' };
  }
  // JPEG: FF D8 FF
  if (startsWith(buf, [0xff, 0xd8, 0xff])) {
    return { ext: '.jpg', mime: 'image/jpeg' };
  }
  // GIF: "GIF87a" / "GIF89a"
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) {
    return { ext: '.gif', mime: 'image/gif' };
  }
  // WEBP
  if (isWebp(buf)) {
    return { ext: '.webp', mime: 'image/webp' };
  }
  // PDF: "%PDF-"
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return { ext: '.pdf', mime: 'application/pdf' };
  }
  // Plain text (no magic number) — validated structurally, checked last.
  if (looksLikeText(buf)) {
    return { ext: '.txt', mime: 'text/plain' };
  }
  return null;
}

// Human-readable description of what we accept, for UI/error messages.
const ALLOWED_DESCRIPTION = 'PNG, JPEG, GIF, WEBP, PDF, or UTF-8 text';

module.exports = { detect, ALLOWED_DESCRIPTION };
