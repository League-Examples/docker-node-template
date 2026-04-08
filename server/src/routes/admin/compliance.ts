import { Router } from 'express';

export const complianceRouter = Router();

// GET /admin/compliance?month=YYYY-MM — compliance report
complianceRouter.get('/', async (req, res, next) => {
  try {
    const month = req.query.month as string | undefined;
    const report = await req.services.compliance.getReport(month);
    res.json(report);
  } catch (err) {
    next(err);
  }
});
