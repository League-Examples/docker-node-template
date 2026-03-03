import { Request, Response, NextFunction } from 'express';

declare module 'express-session' {
  interface SessionData {
    isAdmin?: boolean;
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session.isAdmin) {
    return next();
  }
  res.status(401).json({ error: 'Admin authentication required' });
}
