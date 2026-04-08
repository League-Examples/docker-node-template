import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requireInstructor } from '../middleware/requireInstructor';

export const checkinsRouter = Router();

checkinsRouter.use(requireAuth, requireInstructor);

// GET /api/checkins — get pending check-in data for this week
checkinsRouter.get('/checkins', async (req, res, next) => {
  try {
    const instructorId = (req.user as any).instructorId as number;
    const result = await req.services.checkins.getPending(instructorId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/checkins — submit check-in entries for a week
checkinsRouter.post('/checkins', async (req, res, next) => {
  try {
    const instructorId = (req.user as any).instructorId as number;
    const { weekOf, entries } = req.body as {
      weekOf?: string;
      entries?: Array<{ taName: string; wasPresent: boolean }>;
    };

    if (!weekOf || !Array.isArray(entries)) {
      return res.status(400).json({ error: 'weekOf and entries are required' });
    }

    const result = await req.services.checkins.submit(instructorId, weekOf, entries);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
