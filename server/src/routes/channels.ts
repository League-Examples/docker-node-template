import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requireAdmin } from '../middleware/requireAdmin';

export const channelsRouter = Router();

// GET /api/channels — list all channels with message counts
channelsRouter.get('/channels', requireAuth, async (req, res, next) => {
  try {
    const channels = await req.services.channels.list();
    res.json(channels);
  } catch (err) {
    next(err);
  }
});

// POST /api/channels — create a channel (admin only)
channelsRouter.post('/channels', requireAdmin, async (req, res, next) => {
  try {
    const { name, description } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Channel name is required' });
    }
    const channel = await req.services.channels.create(name.trim(), description);
    res.status(201).json(channel);
  } catch (err: any) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Channel name already exists' });
    }
    next(err);
  }
});

// GET /api/channels/:id — get channel with paginated messages
channelsRouter.get('/channels/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid channel ID' });
    }
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const before = req.query.before ? parseInt(req.query.before as string, 10) : undefined;

    const channel = await req.services.channels.get(id, { limit, before });
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    res.json(channel);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/channels/:id — delete a channel (admin only)
channelsRouter.delete('/channels/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid channel ID' });
    }
    await req.services.channels.delete(id);
    res.status(204).end();
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Channel not found' });
    }
    next(err);
  }
});

// POST /api/channels/:id/messages — post a message to a channel
channelsRouter.post('/channels/:id/messages', requireAuth, async (req, res, next) => {
  try {
    const channelId = parseInt(req.params.id as string, 10);
    if (isNaN(channelId)) {
      return res.status(400).json({ error: 'Invalid channel ID' });
    }
    const { content } = req.body;
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({ error: 'Message content is required' });
    }
    const authorId = (req.user as any).id;
    const message = await req.services.messages.create(channelId, authorId, content.trim());
    res.status(201).json(message);
  } catch (err: any) {
    if (err.code === 'P2003') {
      return res.status(404).json({ error: 'Channel not found' });
    }
    next(err);
  }
});
