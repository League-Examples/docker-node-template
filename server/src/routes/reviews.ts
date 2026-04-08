import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requireInstructor } from '../middleware/requireInstructor';

export const reviewsRouter = Router();

reviewsRouter.use(requireAuth, requireInstructor);

// GET /api/reviews?month=YYYY-MM
reviewsRouter.get('/reviews', async (req, res, next) => {
  try {
    const instructorId = (req.user as any).instructorId as number;
    const month = req.query.month as string | undefined;
    const reviews = await req.services.reviews.list(instructorId, month);
    res.json(reviews);
  } catch (err) {
    next(err);
  }
});

// GET /api/reviews/:id
reviewsRouter.get('/reviews/:id', async (req, res, next) => {
  try {
    const instructorId = (req.user as any).instructorId as number;
    const id = parseInt(req.params.id, 10);
    const review = await req.services.reviews.getById(id, instructorId);
    res.json(review);
  } catch (err) {
    next(err);
  }
});

// POST /api/reviews
reviewsRouter.post('/reviews', async (req, res, next) => {
  try {
    const instructorId = (req.user as any).instructorId as number;
    const { studentId, month } = req.body as { studentId?: number; month?: string };

    if (!studentId || !month) {
      return res.status(400).json({ error: 'studentId and month are required' });
    }

    const { review, created } = await req.services.reviews.create(instructorId, studentId, month);
    res.status(created ? 201 : 200).json(review);
  } catch (err) {
    next(err);
  }
});

// PUT /api/reviews/:id
reviewsRouter.put('/reviews/:id', async (req, res, next) => {
  try {
    const instructorId = (req.user as any).instructorId as number;
    const id = parseInt(req.params.id, 10);
    const { subject, body } = req.body as { subject?: string; body?: string };
    const review = await req.services.reviews.update(id, instructorId, { subject, body });
    res.json(review);
  } catch (err) {
    next(err);
  }
});

// POST /api/reviews/:id/send
reviewsRouter.post('/reviews/:id/send', async (req, res, next) => {
  try {
    const instructorId = (req.user as any).instructorId as number;
    const id = parseInt(req.params.id, 10);

    const { review, guardianEmail } = await req.services.reviews.send(id, instructorId);

    if (guardianEmail) {
      req.services.email.sendReviewEmail({
        toEmail: guardianEmail,
        studentName: review.studentName,
        month: review.month,
        reviewBody: review.body ?? '',
        feedbackToken: review.feedbackToken,
      }).catch((err: unknown) => {
        console.error('Email send failed:', err);
      });
    }

    res.json(review);
  } catch (err) {
    next(err);
  }
});

// POST /api/reviews/:id/send-test
reviewsRouter.post('/reviews/:id/send-test', async (req, res, next) => {
  try {
    const instructorId = (req.user as any).instructorId as number;
    const id = parseInt(req.params.id, 10);
    const { testEmail } = req.body as { testEmail?: string };

    if (!testEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail)) {
      return res.status(400).json({ error: 'A valid testEmail is required' });
    }

    const review = await req.services.reviews.getById(id, instructorId);

    await req.services.email.sendTestReviewEmail({
      toEmail: testEmail,
      studentName: review.studentName,
      month: review.month,
      reviewBody: review.body ?? '',
      feedbackToken: review.feedbackToken,
    });

    res.json({ ok: true, sentTo: testEmail });
  } catch (err) {
    next(err);
  }
});

// POST /api/reviews/:id/generate-github-draft
reviewsRouter.post('/reviews/:id/generate-github-draft', async (req, res, next) => {
  try {
    const instructorId = (req.user as any).instructorId as number;
    const id = parseInt(req.params.id, 10);

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: 'GROQ_API_KEY is not configured on the server' });
    }

    const result = await req.services.reviews.generateDraft(id, instructorId);

    if (!result) {
      return res.status(500).json({ error: 'GROQ_API_KEY is not configured on the server' });
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});
