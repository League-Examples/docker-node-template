import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requireInstructor } from '../middleware/requireInstructor';

export const templatesRouter = Router();

templatesRouter.use(requireAuth, requireInstructor);

// GET /api/templates
templatesRouter.get('/templates', async (req, res, next) => {
  try {
    const instructorId = (req.user as any).instructorId as number;
    const templates = await req.services.templates.list(instructorId);
    res.json(templates);
  } catch (err) {
    next(err);
  }
});

// POST /api/templates
templatesRouter.post('/templates', async (req, res, next) => {
  try {
    const instructorId = (req.user as any).instructorId as number;
    const { name, subject, body } = req.body as { name?: string; subject?: string; body?: string };

    if (!name || !subject || !body) {
      return res.status(400).json({ error: 'name, subject, and body are required' });
    }

    const tmpl = await req.services.templates.create(instructorId, { name, subject, body });
    res.status(201).json(tmpl);
  } catch (err) {
    next(err);
  }
});

// PUT /api/templates/:id
templatesRouter.put('/templates/:id', async (req, res, next) => {
  try {
    const instructorId = (req.user as any).instructorId as number;
    const id = parseInt(req.params.id, 10);
    const { name, subject, body } = req.body as { name?: string; subject?: string; body?: string };
    const tmpl = await req.services.templates.update(id, instructorId, { name, subject, body });
    res.json(tmpl);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/templates/:id
templatesRouter.delete('/templates/:id', async (req, res, next) => {
  try {
    const instructorId = (req.user as any).instructorId as number;
    const id = parseInt(req.params.id, 10);
    await req.services.templates.delete(id, instructorId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
