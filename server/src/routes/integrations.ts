import { Router } from 'express';

export const integrationsRouter = Router();

integrationsRouter.get('/integrations/status', (_req, res) => {
  res.json({
    github: {
      configured: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    },
    google: {
      configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    },
    pike13: {
      configured: !!process.env.PIKE13_ACCESS_TOKEN,
    },
  });
});
