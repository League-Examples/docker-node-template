import { Request, Response, NextFunction } from 'express';

/** Requires an active instructor. Must be used after requireAuth. */
export function requireInstructor(req: Request, res: Response, next: NextFunction) {
  if (!(req.user as any)?.isActiveInstructor) {
    return res.status(403).json({ error: 'Active instructor required' });
  }
  next();
}
