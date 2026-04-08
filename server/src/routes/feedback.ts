import { Router } from 'express';

export const feedbackRouter = Router();

// GET /api/feedback/:token — PUBLIC, no auth required
feedbackRouter.get('/feedback/:token', async (req, res, next) => {
  try {
    const { token } = req.params;
    const result = await req.services.feedback.getByToken(token);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/feedback/:token — PUBLIC, no auth required
feedbackRouter.post('/feedback/:token', async (req, res, next) => {
  try {
    const { token } = req.params;
    const { rating, comment, suggestion } = req.body;
    const result = await req.services.feedback.submit(token, { rating, comment, suggestion });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});
