import { Router } from 'express';

export const notificationsRouter = Router();

// GET /admin/notifications — list all notifications
notificationsRouter.get('/', async (req, res, next) => {
  try {
    const unreadOnly = req.query.unread === 'true';
    const notifications = await req.services.notifications.list(unreadOnly);
    res.json(notifications);
  } catch (err) {
    next(err);
  }
});

// PATCH /admin/notifications/:id/read — mark a notification as read
notificationsRouter.patch('/:id/read', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const notification = await req.services.notifications.markRead(id);
    res.json(notification);
  } catch (err) {
    next(err);
  }
});
