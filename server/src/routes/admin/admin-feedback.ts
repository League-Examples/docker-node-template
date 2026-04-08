import { Router } from 'express';

export const adminFeedbackRouter = Router();

// GET /admin/feedback — list all service feedback with review and student details
adminFeedbackRouter.get('/', async (req, res, next) => {
  try {
    const rows = await req.services.prisma.serviceFeedback.findMany({
      include: {
        review: {
          include: {
            student: { select: { name: true } },
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });

    const result = rows.map((r: any) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      suggestion: r.suggestion,
      submittedAt: (r.submittedAt as Date).toISOString(),
      review: {
        id: r.review.id,
        month: r.review.month,
        studentName: r.review.student.name,
      },
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});
