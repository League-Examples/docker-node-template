import { Router } from 'express';
import { prisma } from '../../services/prisma';

export const adminUsersRouter = Router();

// GET /admin/users - list all users with linked providers
adminUsersRouter.get('/users', async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: { providers: { select: { provider: true } } },
    });
    res.json(users);
  } catch (err) {
    next(err);
  }
});

// POST /admin/users - create a user
adminUsersRouter.post('/users', async (req, res, next) => {
  try {
    const { email, displayName, role } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const user = await req.services.users.create({ email, displayName, role });
    res.status(201).json(user);
  } catch (err: any) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'User with this email already exists' });
    }
    next(err);
  }
});

// PUT /admin/users/:id - update a user
adminUsersRouter.put('/users/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { email, displayName, role } = req.body;
    const user = await req.services.users.update(id, { email, displayName, role });
    res.json(user);
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'User not found' });
    }
    next(err);
  }
});

// DELETE /admin/users/:id - delete a user
adminUsersRouter.delete('/users/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await req.services.users.delete(id);
    res.status(204).end();
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'User not found' });
    }
    next(err);
  }
});
