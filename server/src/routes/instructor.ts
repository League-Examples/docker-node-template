import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requireInstructor } from '../middleware/requireInstructor';

export const instructorRouter = Router();

instructorRouter.use(requireAuth, requireInstructor);

// GET /api/instructor/dashboard?month=YYYY-MM
instructorRouter.get('/instructor/dashboard', async (req, res, next) => {
  try {
    const instructorId = (req.user as any).instructorId as number;
    const month = req.query.month as string | undefined;
    const result = await req.services.instructors.getDashboard(instructorId, month ?? '');
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/instructor/students?month=YYYY-MM
instructorRouter.get('/instructor/students', async (req, res, next) => {
  try {
    const instructorId = (req.user as any).instructorId as number;
    const month = req.query.month as string | undefined;
    const students = await req.services.instructors.getStudents(instructorId, month);
    res.json(students);
  } catch (err) {
    next(err);
  }
});

// POST /api/instructor/sync/pike13
instructorRouter.post('/instructor/sync/pike13', async (req, res, next) => {
  try {
    const instructorId = (req.user as any).instructorId as number;

    const token = await req.services.prisma.pike13Token.findFirst({
      where: { instructorId },
    });

    if (!token) {
      return res.status(409).json({ error: 'No Pike13 token found. Please log out and back in.' });
    }

    let accessToken: string = token.accessToken;

    if (token.expiresAt && token.expiresAt < new Date()) {
      if (!token.refreshToken) {
        return res.status(401).json({ error: 'Pike13 token expired. Please log out and back in.' });
      }

      const refreshRes = await fetch('https://pike13.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: process.env.PIKE13_CLIENT_ID,
          client_secret: process.env.PIKE13_CLIENT_SECRET,
          grant_type: 'refresh_token',
          refresh_token: token.refreshToken,
        }),
      });

      if (!refreshRes.ok) {
        return res.status(401).json({ error: 'Pike13 token refresh failed. Please log out and back in.' });
      }

      const refreshData = (await refreshRes.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      const expiresAt = refreshData.expires_in
        ? new Date(Date.now() + refreshData.expires_in * 1000)
        : null;

      await req.services.prisma.pike13Token.update({
        where: { id: token.id },
        data: {
          accessToken: refreshData.access_token,
          refreshToken: refreshData.refresh_token ?? token.refreshToken,
          expiresAt,
        },
      });

      accessToken = refreshData.access_token;
    }

    const result = await req.services.pike13Sync.runSync(accessToken);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
