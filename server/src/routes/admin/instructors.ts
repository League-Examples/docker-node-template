import { Router } from 'express';

export const instructorsAdminRouter = Router();

// GET /admin/instructors — list all instructors
instructorsAdminRouter.get('/', async (req, res, next) => {
  try {
    const instructors = await req.services.instructors.list();
    res.json(instructors);
  } catch (err) {
    next(err);
  }
});

// PATCH /admin/instructors/:id — activate or deactivate an instructor
instructorsAdminRouter.patch('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { isActive } = req.body as { isActive?: boolean };

    if (isActive === undefined) {
      return res.status(400).json({ error: 'isActive is required' });
    }

    const instructor = isActive
      ? await req.services.instructors.activate(id)
      : await req.services.instructors.deactivate(id);

    res.json(instructor);
  } catch (err) {
    next(err);
  }
});
