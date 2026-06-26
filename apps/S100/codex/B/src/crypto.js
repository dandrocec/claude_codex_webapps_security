const crypto = require("crypto");

function encryptionKey() {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) {
    throw new Error("APP_ENCRYPTION_KEY must be at least 32 characters");
  }
  return crypto.createHash("sha256").update(raw).digest();
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

function decryptSecret(payload) {
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function redactSecrets(text, secretValues) {
  let safe = String(text);
  for (const value of secretValues) {
    if (value && value.length >= 3) {
      safe = safe.split(value).join("[REDACTED]");
    }
  }
  return safe;
}

module.exports = { encryptSecret, decryptSecret, redactSecrets };
