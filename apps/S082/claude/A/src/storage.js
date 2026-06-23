'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

// Each user gets an isolated folder named by their numeric id.
function userDir(userId) {
  const dir = path.join(UPLOAD_ROOT, String(userId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Absolute path of a stored file, guarded against path traversal:
// the resolved path must stay inside the owner's folder.
function storedFilePath(userId, storedName) {
  const dir = userDir(userId);
  const full = path.resolve(dir, storedName);
  if (full !== path.join(dir, path.basename(storedName))) {
    throw new Error('Invalid stored file path');
  }
  return full;
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, userDir(req.session.userId));
  },
  filename(req, file, cb) {
    // Random opaque name on disk; the human name lives in the DB.
    const ext = path.extname(file.originalname).slice(0, 20);
    cb(null, crypto.randomBytes(16).toString('hex') + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB per file
});

module.exports = { UPLOAD_ROOT, userDir, storedFilePath, upload };
