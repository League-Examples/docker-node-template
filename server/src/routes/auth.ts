import { Router, Request, Response } from 'express';
import passport from 'passport';
import pkg_github2 from 'passport-github2';
import pkg_google from 'passport-google-oauth20';

export const authRouter = Router();

// --- GitHub OAuth Strategy ---
// Register only if credentials are configured.
// Docs: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  const GitHubStrategy = pkg_github2.Strategy;
  passport.use(new GitHubStrategy(
    {
      clientID: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL: process.env.GITHUB_CALLBACK_URL || '/api/auth/github/callback',
      proxy: true,
      scope: ['read:user', 'user:email'],
    },
    (_accessToken: string, _refreshToken: string, profile: any, done: any) => {
      const user = {
        provider: 'github' as const,
        id: profile.id,
        displayName: profile.displayName || profile.username,
        email: profile.emails?.[0]?.value || '',
        avatar: profile.photos?.[0]?.value || '',
        accessToken: _accessToken,
      };
      done(null, user);
    },
  ));
  if (process.env.NODE_ENV !== 'test') console.log('GitHub OAuth strategy registered');
} else {
  if (process.env.NODE_ENV !== 'test') console.log('GitHub OAuth not configured — set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET');
}

// GitHub OAuth initiation
authRouter.get('/auth/github', (req: Request, res: Response, next) => {
  if (!(passport as any)._strategy('github')) {
    return res.status(501).json({
      error: 'GitHub OAuth not configured',
      docs: 'https://github.com/settings/developers',
    });
  }
  passport.authenticate('github', { scope: ['read:user', 'user:email'] })(req, res, next);
});

// GitHub OAuth callback
authRouter.get('/auth/github/callback',
  (req: Request, res: Response, next) => {
    if (!(passport as any)._strategy('github')) {
      return res.status(501).json({ error: 'GitHub OAuth not configured' });
    }
    passport.authenticate('github', { failureRedirect: '/' })(req, res, next);
  },
  (_req: Request, res: Response) => {
    res.redirect('/');
  },
);

// --- Google OAuth Strategy ---
// Register only if credentials are configured.
// Docs: https://developers.google.com/identity/protocols/oauth2/web-server
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  const GoogleStrategy = pkg_google.Strategy;
  passport.use(new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback',
      proxy: true,
      scope: ['profile', 'email'],
    },
    (_accessToken: string, _refreshToken: string, profile: any, done: any) => {
      const user = {
        provider: 'google' as const,
        id: profile.id,
        displayName: profile.displayName || '',
        email: profile.emails?.[0]?.value || '',
        avatar: profile.photos?.[0]?.value || '',
      };
      done(null, user);
    },
  ));
  if (process.env.NODE_ENV !== 'test') console.log('Google OAuth strategy registered');
} else {
  if (process.env.NODE_ENV !== 'test') console.log('Google OAuth not configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET');
}

// Google OAuth initiation
// Setup: https://console.cloud.google.com/apis/credentials
authRouter.get('/auth/google', (req: Request, res: Response, next) => {
  if (!(passport as any)._strategy('google')) {
    return res.status(501).json({
      error: 'Google OAuth not configured',
      docs: 'https://console.cloud.google.com/apis/credentials',
    });
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

// Google OAuth callback
authRouter.get('/auth/google/callback',
  (req: Request, res: Response, next) => {
    if (!(passport as any)._strategy('google')) {
      return res.status(501).json({ error: 'Google OAuth not configured' });
    }
    passport.authenticate('google', { failureRedirect: '/' })(req, res, next);
  },
  (_req: Request, res: Response) => {
    res.redirect('/');
  },
);

// --- Shared auth endpoints ---

// Get current user
authRouter.get('/auth/me', (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json(req.user);
});

// Logout
authRouter.post('/auth/logout', (req: Request, res: Response, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy((err) => {
      if (err) return next(err);
      res.json({ success: true });
    });
  });
});
