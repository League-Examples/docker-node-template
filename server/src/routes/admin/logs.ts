import { Router } from 'express';
import { logBuffer } from '../../services/logBuffer';

export const adminLogsRouter = Router();

adminLogsRouter.get('/logs', (_req, res) => {
  const levelParam = _req.query.level as string | undefined;
  const minLevel = levelParam ? parseInt(levelParam, 10) : undefined;

  const entries = logBuffer.getEntries(
    minLevel && !isNaN(minLevel) ? minLevel : undefined,
  );

  res.json({ entries, total: logBuffer.size });
});
