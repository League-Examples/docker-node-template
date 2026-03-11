import { Request, Response, NextFunction } from 'express';

declare module 'express-session' {
  interface SessionData {
    isAdmin?: boolean;
  }
}

/** Requires an authenticated user with ADMIN role. Returns 401 or 403. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  // Support both DB-backed user role and legacy session-based admin auth
  if (req.user && (req.user as any).role === 'ADMIN') {
    return next();
  }
  if (req.session.isAdmin) {
    return next();
  }
  if (!req.user && !req.session.isAdmin) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  res.status(403).json({ error: 'Admin access required' });
}
