import { Router } from 'express';
import { getAllConfig, setConfig, exportConfig } from '../../services/config';

export const adminConfigRouter = Router();

adminConfigRouter.get('/config', (_req, res) => {
  res.json(getAllConfig());
});

adminConfigRouter.put('/config', async (req, res, next) => {
  try {
    const { key, value } = req.body;
    if (!key || typeof key !== 'string' || typeof value !== 'string') {
      return res.status(400).json({ error: 'key and value are required strings' });
    }

    const result = await setConfig(key, value);
    res.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Unknown config key')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

adminConfigRouter.get('/config/export', (_req, res) => {
  const content = exportConfig();
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename=config-export.env');
  res.send(content);
});
