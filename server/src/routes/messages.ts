import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';

export const messagesRouter = Router();

// DELETE /api/messages/:id — delete a message (author or admin)
messagesRouter.delete('/messages/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid message ID' });
    }

    const message = await req.services.messages.getById(id);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const user = req.user as any;
    const isAuthor = message.authorId === user.id;
    const isAdmin = user.role === 'ADMIN';

    if (!isAuthor && !isAdmin) {
      return res.status(403).json({ error: 'Not authorized to delete this message' });
    }

    await req.services.messages.delete(id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
