'use strict';

const multer = require('multer');
const config = require('../config');

// Allow-list of accepted image types, keyed by what we detect from the file's
// actual bytes (magic numbers) — NOT the client-supplied name or Content-Type.
const ALLOWED = [
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', mime: 'image/png', test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a },
  { ext: 'gif', mime: 'image/gif', test: (b) => b.length > 5 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61 },
  {
    ext: 'webp',
    mime: 'image/webp',
    test: (b) =>
      b.length > 12 &&
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50, // WEBP
  },
];

// Keep the file in memory so we can inspect its content before deciding to persist
// it under a server-generated name. multer enforces the hard size limit for us.
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxUploadBytes,
    files: 1,
    fields: 20,
  },
});

// Inspect the buffer and return the matching allow-list entry, or null.
function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  return ALLOWED.find((entry) => entry.test(buffer)) || null;
}

const rawSingle = memoryUpload.single('photo');

// Translate multer's errors (e.g. file too large) into client-safe messages
// instead of letting them surface as a generic 500.
function single(req, res, next) {
  rawSingle(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const friendly =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'File is too large (max ' + Math.round(config.maxUploadBytes / (1024 * 1024)) + ' MB).'
          : 'Invalid upload.';
      return next(Object.assign(new Error(friendly), { status: 413, expose: true }));
    }
    return next(err);
  });
}

module.exports = {
  single,
  detectImageType,
  allowedDescription: 'JPEG, PNG, GIF, or WebP',
};
