import { Router, Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { prisma } from '../services/prisma';

export const authRouter = Router();

// ---------------------------------------------------------------------------
// find-or-create helper
// ---------------------------------------------------------------------------

/**
 * Resolves (or creates) the User record for an incoming OAuth callback.
 *
 * Priority order (login mode):
 *   1. Look up UserProvider by (provider, providerId) → return existing user.
 *   2. If email provided, look up User by email → create UserProvider row, return user.
 *   3. Create new User + UserProvider row.
 *
 * Link mode (req.session.oauthLinkMode === true):
 *   1. Require req.user (authenticated session).
 *   2. Bind the OAuth identity to req.user.id.
 *   3. Clear oauthLinkMode from session.
 */
export async function findOrCreateOAuthUser(
  req: Request,
  provider: string,
  providerId: string,
  email: string | undefined,
  displayName: string | undefined,
): Promise<any> {
  const session = req.session as any;

  // --- Step 1: look up by (provider, providerId) ---
  const existingProvider = await prisma.userProvider.findUnique({
    where: { provider_providerId: { provider, providerId } },
    include: { user: true },
  });

  if (existingProvider) {
    // Already linked — handle link-mode no-op
    if (session.oauthLinkMode) {
      const currentUser = req.user as any;
      if (!currentUser) {
        throw new Error('Link mode requires an authenticated session');
      }
      if (existingProvider.userId !== currentUser.id) {
        const err = new Error('OAuth identity already bound to a different account') as any;
        err.status = 409;
        throw err;
      }
      // Already linked to the same user — no-op
      delete session.oauthLinkMode;
    }
    return existingProvider.user;
  }

  // --- Link mode: bind to current session user ---
  if (session.oauthLinkMode) {
    const currentUser = req.user as any;
    if (!currentUser) {
      const err = new Error('Link mode requires an authenticated session') as any;
      err.status = 401;
      throw err;
    }
    await prisma.userProvider.create({
      data: { userId: currentUser.id, provider, providerId },
    });
    delete session.oauthLinkMode;
    // Return the full user from DB (req.user may be stale)
    const refreshed = await prisma.user.findUnique({ where: { id: currentUser.id } });
    return refreshed ?? currentUser;
  }

  // --- Step 2: email auto-link ---
  if (email) {
    const emailUser = await prisma.user.findUnique({ where: { email } });
    if (emailUser) {
      await prisma.userProvider.create({
        data: { userId: emailUser.id, provider, providerId },
      });
      return emailUser;
    }
  }

  // --- Step 3: create new user ---
  const newUser = await prisma.user.create({
    data: {
      email: email ?? `${provider}:${providerId}@oauth.local`,
      displayName: displayName ?? null,
      role: 'USER',
      provider,
      providerId,
      providers: {
        create: { provider, providerId },
      },
    },
  });
  return newUser;
}

// ---------------------------------------------------------------------------
// Conditional strategy registration
// ---------------------------------------------------------------------------

if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  passport.use(
    'github',
    new GitHubStrategy(
      {
        clientID: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        callbackURL: '/api/auth/github/callback',
        scope: ['read:user', 'user:email'],
        passReqToCallback: true,
      } as any,
      async (req: any, accessToken: string, _refreshToken: any, profile: any, done: any) => {
        (req.session as any).githubAccessToken = accessToken;
        try {
          const user = await findOrCreateOAuthUser(
            req,
            'github',
            String(profile.id),
            profile.emails?.[0]?.value,
            profile.displayName ?? profile.username,
          );
          done(null, user);
        } catch (err) {
          done(err);
        }
      },
    ),
  );
}

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    'google',
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: '/api/auth/google/callback',
        passReqToCallback: true,
      } as any,
      async (req: any, accessToken: string, _refreshToken: any, profile: any, done: any) => {
        (req.session as any).googleAccessToken = accessToken;
        try {
          const user = await findOrCreateOAuthUser(
            req,
            'google',
            String(profile.id),
            profile.emails?.[0]?.value,
            profile.displayName ?? profile.name?.givenName,
          );
          done(null, user);
        } catch (err) {
          done(err);
        }
      },
    ),
  );
}

// ---------------------------------------------------------------------------
// Demo login credentials
// ---------------------------------------------------------------------------
// These are intentionally hardcoded for template demonstration purposes.
const DEMO_CREDENTIALS = [
  { username: 'user',  password: 'pass',  email: 'user@demo.local',  displayName: 'Demo User',  role: 'USER'  as const },
  { username: 'admin', password: 'admin', email: 'admin@demo.local', displayName: 'Demo Admin', role: 'ADMIN' as const },
];

// POST /api/auth/demo-login
// Authenticates against hardcoded credential pairs; finds or creates the User record.
authRouter.post('/auth/demo-login', async (req: Request, res: Response) => {
  const { username, password } = req.body ?? {};

  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const match = DEMO_CREDENTIALS.find(
    (c) => c.username === username && c.password === password,
  );

  if (!match) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  try {
    const user = await prisma.user.upsert({
      where: { email: match.email },
      update: { role: match.role },
      create: {
        email: match.email,
        displayName: match.displayName,
        role: match.role,
      },
    });

    req.login(user, (err) => {
      if (err) return res.status(500).json({ error: 'Login failed' });
      res.json({
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
        },
      });
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// --- Test login (non-production only) ---
authRouter.post('/auth/test-login', async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  try {
    const { email, displayName, role, provider, providerId } = req.body;
    const resolvedEmail = email || 'test@example.com';
    const user = await prisma.user.upsert({
      where: { email: resolvedEmail },
      update: { displayName, role: role || 'USER' },
      create: {
        email: resolvedEmail,
        displayName: displayName || 'Test User',
        role: role || 'USER',
        provider: provider || 'test',
        providerId: providerId || `test-${resolvedEmail}`,
      },
    });
    req.login(user, (err) => {
      if (err) return res.status(500).json({ error: 'Login failed' });
      res.json(user);
    });
  } catch (err) {
    res.status(500).json({ error: 'Test login failed' });
  }
});

// ---------------------------------------------------------------------------
// Shared auth endpoints
// ---------------------------------------------------------------------------

// Get current user
authRouter.get('/auth/me', (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const user = req.user as any;
  const realAdmin = (req as any).realAdmin as any | undefined;
  res.json({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    avatarUrl: user.avatarUrl,
    provider: user.provider,
    providerId: user.providerId,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    impersonating: !!realAdmin,
    realAdmin: realAdmin
      ? { id: realAdmin.id, displayName: realAdmin.displayName ?? null }
      : null,
  });
});

// Logout
authRouter.post('/auth/logout', (req: Request, res: Response, next: NextFunction) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy((err) => {
      if (err) return next(err);
      res.json({ success: true });
    });
  });
});

// ---------------------------------------------------------------------------
// GitHub OAuth routes
// ---------------------------------------------------------------------------

authRouter.get('/auth/github', (req: Request, res: Response, next: NextFunction) => {
  if (!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)) {
    return res.status(501).json({
      error: 'GitHub OAuth not configured',
      docs: 'https://github.com/settings/developers',
    });
  }
  if (req.query.link === '1') {
    (req.session as any).oauthLinkMode = true;
  }
  passport.authenticate('github')(req, res, next);
});

authRouter.get(
  '/auth/github/callback',
  (req: Request, res: Response, next: NextFunction) => {
    passport.authenticate('github', { failureRedirect: '/login' })(req, res, next);
  },
  (req: Request, res: Response) => {
    // oauthLinkMode is cleared inside findOrCreateOAuthUser; check was done before auth
    res.redirect('/');
  },
);

// ---------------------------------------------------------------------------
// Google OAuth routes
// ---------------------------------------------------------------------------

authRouter.get('/auth/google', (req: Request, res: Response, next: NextFunction) => {
  if (!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)) {
    return res.status(501).json({
      error: 'Google OAuth not configured',
      docs: 'https://console.cloud.google.com/apis/credentials',
    });
  }
  if (req.query.link === '1') {
    (req.session as any).oauthLinkMode = true;
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

authRouter.get(
  '/auth/google/callback',
  (req: Request, res: Response, next: NextFunction) => {
    passport.authenticate('google', { failureRedirect: '/login' })(req, res, next);
  },
  (req: Request, res: Response) => {
    res.redirect('/');
  },
);
