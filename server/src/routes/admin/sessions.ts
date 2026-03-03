import { Router } from 'express';
import { prisma } from '../../services/prisma';

export const adminSessionsRouter = Router();

interface SessionRow {
  sid: string;
  sess: Record<string, unknown>;
  expire: Date;
}

adminSessionsRouter.get('/sessions', async (_req, res, next) => {
  try {
    const sessions = await prisma.$queryRaw<SessionRow[]>`
      SELECT sid, sess, expire
      FROM session
      WHERE expire > NOW()
      ORDER BY expire DESC
    `;

    const result = sessions.map((s) => {
      const sess = s.sess as Record<string, unknown>;

      // Extract OAuth user info from passport session data
      let hasUser = false;
      let provider: string | null = null;
      if (sess.passport && typeof sess.passport === 'object') {
        const passport = sess.passport as Record<string, unknown>;
        if (passport.user && typeof passport.user === 'object') {
          hasUser = true;
          const user = passport.user as Record<string, unknown>;
          provider = (user.provider as string) || null;
        }
      }

      return {
        sid: s.sid.slice(0, 8),
        expire: s.expire,
        isAdmin: !!(sess.isAdmin),
        hasUser,
        provider,
      };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});
