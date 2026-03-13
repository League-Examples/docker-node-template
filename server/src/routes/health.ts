import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    appName: process.env.APP_NAME || 'Chat App',
    appSlug: process.env.APP_SLUG || 'chat-app',
  });
});
