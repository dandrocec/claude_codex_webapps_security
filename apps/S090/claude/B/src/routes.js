'use strict';

const express = require('express');
const passport = require('./auth');
const { findUserById } = require('./db');
const { decrypt } = require('./crypto');
const { verifyCsrf, requireAuth, requireSelf } = require('./middleware');

const router = express.Router();

/**
 * Call the GitHub API on the user's behalf using their (decrypted) token.
 * Returns a small, sanitised summary — we never pass raw API HTML through.
 */
async function fetchGitHubAccountData(user) {
  const token = decrypt(user.access_token);
  if (!token) throw new Error('No access token available for user');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch('https://api.github.com/user/repos?per_page=5&sort=updated', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'oauth-secure-app',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`GitHub API responded ${res.status}`);
    const repos = await res.json();
    // Only keep primitive fields we intend to render (values are HTML-escaped
    // at render time by EJS, giving context-aware output encoding).
    return (Array.isArray(repos) ? repos : []).slice(0, 5).map((r) => ({
      name: String(r.name ?? ''),
      fullName: String(r.full_name ?? ''),
      private: Boolean(r.private),
      stars: Number.isFinite(r.stargazers_count) ? r.stargazers_count : 0,
      htmlUrl: typeof r.html_url === 'string' ? r.html_url : '',
    }));
  } finally {
    clearTimeout(timeout);
  }
}

// --- Public pages ----------------------------------------------------------

router.get('/', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/dashboard');
  res.render('home', { query: req.query });
});

// --- OAuth flow ------------------------------------------------------------

// Passport adds an unguessable `state` param to mitigate CSRF on the OAuth
// handshake itself.
router.get('/auth/github', passport.authenticate('github'));

router.get(
  '/auth/github/callback',
  passport.authenticate('github', { failureRedirect: '/?error=auth' }),
  (req, res) => {
    // Prevent session fixation: issue a fresh session id on privilege change.
    req.session.regenerate((err) => {
      if (err) return res.redirect('/?error=session');
      // passport stores the user id under req.session.passport; re-login to
      // re-attach it to the regenerated session.
      req.login(req.user, (err2) => {
        if (err2) return res.redirect('/?error=session');
        res.redirect('/dashboard');
      });
    });
  }
);

router.post('/logout', verifyCsrf, requireAuth, (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.clearCookie('sid');
      res.redirect('/');
    });
  });
});

// --- Authenticated pages ---------------------------------------------------

router.get('/dashboard', requireAuth, async (req, res, next) => {
  let repos = null;
  let apiError = null;
  try {
    repos = await fetchGitHubAccountData(req.user);
  } catch (err) {
    // Surface a friendly message; details stay in the server log.
    req.log?.warn?.(err);
    apiError = 'Could not load your GitHub account data right now.';
  }
  res.render('dashboard', { profile: req.user, repos, apiError });
});

// Own-profile JSON endpoint. The :id must match the session user (anti-IDOR).
router.get('/users/:id/profile', requireAuth, requireSelf('id'), (req, res) => {
  const user = findUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  // Never expose secrets such as the access token.
  res.json({
    id: user.id,
    provider: user.provider,
    username: user.username,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    profileUrl: user.profile_url,
    email: user.email,
    createdAt: user.created_at,
  });
});

module.exports = router;
