import { Router } from 'express';

export const volunteerHoursRouter = Router();

// GET /admin/volunteer-hours — list volunteer hours with optional filters
volunteerHoursRouter.get('/', async (req, res, next) => {
  try {
    const { volunteerName, category, from, to } = req.query as Record<string, string | undefined>;
    const hours = await req.services.volunteers.list({ volunteerName, category, from, to });
    res.json(hours);
  } catch (err) {
    next(err);
  }
});

// GET /admin/volunteer-hours/summary — aggregated hours summary
volunteerHoursRouter.get('/summary', async (req, res, next) => {
  try {
    const { from, to } = req.query as Record<string, string | undefined>;
    const summary = await req.services.volunteers.getSummary(from, to);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

// POST /admin/volunteer-hours — create a volunteer hour entry
volunteerHoursRouter.post('/', async (req, res, next) => {
  try {
    const { volunteerName, category, hours, description, recordedAt } = req.body as {
      volunteerName?: string;
      category?: string;
      hours?: number;
      description?: string;
      recordedAt?: string;
    };

    if (!volunteerName || !category || hours === undefined) {
      return res.status(400).json({ error: 'volunteerName, category, and hours are required' });
    }

    const entry = await req.services.volunteers.create({
      volunteerName,
      category,
      hours,
      description,
      recordedAt,
    });
    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
});

// PUT /admin/volunteer-hours/:id — update a volunteer hour entry
volunteerHoursRouter.put('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { volunteerName, category, hours, description, recordedAt } = req.body as {
      volunteerName?: string;
      category?: string;
      hours?: number;
      description?: string;
      recordedAt?: string;
    };
    const entry = await req.services.volunteers.update(id, {
      volunteerName,
      category,
      hours,
      description,
      recordedAt,
    });
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

// DELETE /admin/volunteer-hours/:id — delete a volunteer hour entry
volunteerHoursRouter.delete('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await req.services.volunteers.delete(id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
