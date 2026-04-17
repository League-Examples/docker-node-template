import { Router, Request, Response } from 'express';
import { prisma } from '../services/prisma';

export const authRouter = Router();

// --- Demo login credentials ---
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

// --- Shared auth endpoints ---

// Get current user
authRouter.get('/auth/me', (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const user = req.user as any;
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
  });
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
