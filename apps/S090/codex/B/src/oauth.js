const crypto = require('crypto');
const axios = require('axios');
const sanitizeHtml = require('sanitize-html');
const { URLSearchParams } = require('url');
const { get, run } = require('./db');

const REQUIRED_ENV = [
  'APP_ORIGIN',
  'SESSION_SECRET',
  'OAUTH_CLIENT_ID',
  'OAUTH_CLIENT_SECRET',
  'OAUTH_AUTHORIZATION_URL',
  'OAUTH_TOKEN_URL',
  'OAUTH_USERINFO_URL',
  'OAUTH_CALLBACK_URL'
];

function requireConfig() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

function base64Url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createPkcePair() {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function cleanText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }
  const cleaned = sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).trim();
  return cleaned.slice(0, 255) || fallback;
}

function cleanUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    const parsed = new URL(value);
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString().slice(0, 2048);
  } catch {
    return null;
  }
}

function makeAuthorizationUrl(session) {
  const state = base64Url(crypto.randomBytes(32));
  const nonce = base64Url(crypto.randomBytes(32));
  const { verifier, challenge } = createPkcePair();
  session.oauth = { state, nonce, verifier, createdAt: Date.now() };

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.OAUTH_CLIENT_ID,
    redirect_uri: process.env.OAUTH_CALLBACK_URL,
    scope: process.env.OAUTH_SCOPE || 'openid profile email',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  });

  return `${process.env.OAUTH_AUTHORIZATION_URL}?${params.toString()}`;
}

async function exchangeCodeForToken(code, verifier) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.OAUTH_CALLBACK_URL,
    client_id: process.env.OAUTH_CLIENT_ID,
    client_secret: process.env.OAUTH_CLIENT_SECRET,
    code_verifier: verifier
  });

  const response = await axios.post(process.env.OAUTH_TOKEN_URL, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 8000,
    validateStatus: (status) => status >= 200 && status < 300
  });

  return response.data;
}

async function fetchUserInfo(accessToken, tokenType = 'Bearer') {
  const response = await axios.get(process.env.OAUTH_USERINFO_URL, {
    headers: { Authorization: `${tokenType || 'Bearer'} ${accessToken}` },
    timeout: 8000,
    validateStatus: (status) => status >= 200 && status < 300
  });
  return response.data;
}

function normalizeProfile(profile) {
  const providerUserId = cleanText(
    String(profile.sub || profile.id || profile.user_id || ''),
    ''
  );
  if (!providerUserId) {
    throw new Error('Provider profile did not include a stable user id');
  }

  return {
    provider: cleanText(process.env.OAUTH_PROVIDER_NAME || 'oauth-provider', 'oauth-provider'),
    providerUserId,
    displayName: cleanText(profile.name || profile.login || profile.username, 'OAuth user'),
    email: cleanText(profile.email || '', ''),
    avatarUrl: cleanUrl(profile.picture || profile.avatar_url || profile.avatar)
  };
}

async function upsertUserAndToken(profile, token) {
  const existing = await get(
    'SELECT id FROM users WHERE provider = ? AND provider_user_id = ?',
    [profile.provider, profile.providerUserId]
  );

  let userId = existing && existing.id;
  if (userId) {
    await run(
      `UPDATE users
       SET display_name = ?, email = ?, avatar_url = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [profile.displayName, profile.email || null, profile.avatarUrl, userId]
    );
  } else {
    const result = await run(
      `INSERT INTO users (provider, provider_user_id, display_name, email, avatar_url)
       VALUES (?, ?, ?, ?, ?)`,
      [profile.provider, profile.providerUserId, profile.displayName, profile.email || null, profile.avatarUrl]
    );
    userId = result.id;
  }

  const expiresAt = token.expires_in
    ? Math.floor(Date.now() / 1000) + Number(token.expires_in)
    : null;

  await run(
    `INSERT INTO oauth_tokens
       (user_id, access_token, refresh_token, token_type, scope, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = COALESCE(excluded.refresh_token, oauth_tokens.refresh_token),
       token_type = excluded.token_type,
       scope = excluded.scope,
       expires_at = excluded.expires_at,
       updated_at = CURRENT_TIMESTAMP`,
    [
      userId,
      token.access_token,
      token.refresh_token || null,
      token.token_type || 'Bearer',
      token.scope || null,
      expiresAt
    ]
  );

  return userId;
}

async function fetchAccountDataForUser(userId) {
  if (!process.env.OAUTH_ACCOUNT_API_URL) {
    return { configured: false };
  }

  const token = await get(
    'SELECT access_token, token_type, expires_at FROM oauth_tokens WHERE user_id = ?',
    [userId]
  );
  if (!token) {
    return { configured: true, error: 'No provider token is available for this account.' };
  }

  if (token.expires_at && token.expires_at < Math.floor(Date.now() / 1000)) {
    return { configured: true, error: 'The provider token has expired. Please sign in again.' };
  }

  const response = await axios.get(process.env.OAUTH_ACCOUNT_API_URL, {
    headers: { Authorization: `${token.token_type || 'Bearer'} ${token.access_token}` },
    timeout: 8000,
    validateStatus: (status) => status >= 200 && status < 300
  });

  return { configured: true, data: response.data };
}

module.exports = {
  requireConfig,
  makeAuthorizationUrl,
  exchangeCodeForToken,
  fetchUserInfo,
  normalizeProfile,
  upsertUserAndToken,
  fetchAccountDataForUser
};
