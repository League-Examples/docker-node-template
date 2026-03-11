import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';

export const searchRouter = Router();

// GET /api/search?q=... — search channels and messages
searchRouter.get('/search', requireAuth, async (req, res, next) => {
  try {
    const q = req.query.q as string;
    if (!q || typeof q !== 'string' || q.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const query = q.trim();
    const prisma = req.services.prisma;

    const [channels, messages] = await Promise.all([
      prisma.channel.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
          ],
        },
        take: 5,
        orderBy: { name: 'asc' },
      }),
      prisma.message.findMany({
        where: {
          content: { contains: query, mode: 'insensitive' },
        },
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          author: { select: { id: true, displayName: true, email: true, avatarUrl: true } },
          channel: { select: { id: true, name: true } },
        },
      }),
    ]);

    res.json({ channels, messages });
  } catch (err) {
    next(err);
  }
});
