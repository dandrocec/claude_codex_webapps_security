'use strict';

const passport = require('passport');
const { Strategy: GitHubStrategy } = require('passport-github2');
const { upsertUser, getUserById } = require('./db');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5090';

function configurePassport() {
  passport.use(
    new GitHubStrategy(
      {
        clientID: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        callbackURL: `${BASE_URL}/auth/github/callback`,
        // "user:email" lets us read the user's email; "repo" is intentionally
        // omitted so we only request read access to public profile data.
        scope: ['read:user', 'user:email'],
      },
      // The "verify" callback: persist the basic profile + token, then hand the
      // stored user row to Passport.
      function verify(accessToken, _refreshToken, profile, done) {
        try {
          const user = upsertUser({
            provider: 'github',
            provider_id: String(profile.id),
            username: profile.username || null,
            display_name: profile.displayName || profile.username || null,
            avatar_url: profile.photos && profile.photos[0] ? profile.photos[0].value : null,
            profile_url: profile.profileUrl || null,
            access_token: accessToken,
          });
          return done(null, user);
        } catch (err) {
          return done(err);
        }
      }
    )
  );

  // Store only the primary key in the session; rehydrate from the DB per request.
  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser((id, done) => {
    try {
      done(null, getUserById(id) || false);
    } catch (err) {
      done(err);
    }
  });
}

module.exports = { configurePassport };
