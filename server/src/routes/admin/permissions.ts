import { Router } from 'express';

export const adminPermissionsRouter = Router();

// GET /admin/permissions/patterns — list all patterns
adminPermissionsRouter.get('/permissions/patterns', async (req, res, next) => {
  try {
    const patterns = await req.services.permissions.listPatterns();
    res.json(patterns);
  } catch (err) {
    next(err);
  }
});

// POST /admin/permissions/patterns — create a new pattern
adminPermissionsRouter.post('/permissions/patterns', async (req, res, next) => {
  try {
    const { matchType, pattern, role } = req.body;
    const created = await req.services.permissions.createPattern(matchType, pattern, role);
    res.status(201).json(created);
  } catch (err: any) {
    if (err.message?.includes('Invalid') || err.message?.includes('must be') || err.message?.includes('exceeds') || err.message?.includes('regex pattern')) {
      return res.status(400).json({ error: err.message });
    }
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Pattern already exists' });
    }
    next(err);
  }
});

// PUT /admin/permissions/patterns/:id — update a pattern
adminPermissionsRouter.put('/permissions/patterns/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const updated = await req.services.permissions.updatePattern(id, req.body);
    res.json(updated);
  } catch (err: any) {
    if (err.message?.includes('Invalid') || err.message?.includes('must be') || err.message?.includes('exceeds') || err.message?.includes('regex pattern')) {
      return res.status(400).json({ error: err.message });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Pattern not found' });
    }
    next(err);
  }
});

// DELETE /admin/permissions/patterns/:id — delete a pattern
adminPermissionsRouter.delete('/permissions/patterns/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    await req.services.permissions.deletePattern(id);
    res.status(204).end();
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Pattern not found' });
    }
    next(err);
  }
});
