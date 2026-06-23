'use strict';

const passport = require('passport');
const { Strategy: GitHubStrategy } = require('passport-github2');
const config = require('./config');
const { upsertUser, findUserById } = require('./db');
const { encrypt } = require('./crypto');

/**
 * OAuth (GitHub) authentication wiring.
 *
 * We only persist the minimal profile we need, and we store the access token
 * encrypted (see crypto.js). The session stores nothing but the user's local
 * id; the full user record is loaded from the DB on each request.
 */

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  try {
    const user = findUserById(id);
    done(null, user || false);
  } catch (err) {
    done(err);
  }
});

passport.use(
  new GitHubStrategy(
    {
      clientID: config.github.clientID,
      clientSecret: config.github.clientSecret,
      callbackURL: config.github.callbackURL,
      scope: config.github.scope,
    },
    (accessToken, _refreshToken, profile, done) => {
      try {
        const emails = Array.isArray(profile.emails) ? profile.emails : [];
        const record = {
          provider: 'github',
          provider_id: String(profile.id),
          username: profile.username || `user-${profile.id}`,
          display_name: profile.displayName || profile.username || null,
          avatar_url: profile.photos && profile.photos[0] ? profile.photos[0].value : null,
          profile_url: profile.profileUrl || null,
          email: emails[0] ? emails[0].value : null,
          // Encrypt the token before it ever touches the database.
          access_token: encrypt(accessToken),
        };
        const user = upsertUser(record);
        done(null, user);
      } catch (err) {
        done(err);
      }
    }
  )
);

module.exports = passport;
