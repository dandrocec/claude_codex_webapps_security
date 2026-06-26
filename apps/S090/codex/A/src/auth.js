const GitHubStrategy = require('passport-github2').Strategy;
const { findProfileById, upsertProfile } = require('./db');

function configurePassport(passport) {
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      const profile = await findProfileById(id);
      done(null, profile || false);
    } catch (err) {
      done(err);
    }
  });

  passport.use(
    new GitHubStrategy(
      {
        clientID: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        callbackURL: '/auth/github/callback'
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const storedProfile = await upsertProfile({
            provider: 'github',
            providerId: profile.id,
            username: profile.username,
            displayName: profile.displayName || profile.username,
            profileUrl: profile.profileUrl,
            avatarUrl: profile.photos && profile.photos[0] ? profile.photos[0].value : null,
            accessToken
          });

          done(null, storedProfile);
        } catch (err) {
          done(err);
        }
      }
    )
  );
}

module.exports = configurePassport;
