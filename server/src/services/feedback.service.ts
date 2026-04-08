import { NotFoundError, ValidationError, ConflictError } from '../errors.js';

export class FeedbackService {
  private prisma: any;

  constructor(prisma: any) {
    this.prisma = prisma;
  }

  /** Get review details by feedback token. */
  async getByToken(token: string): Promise<{
    studentName: string;
    month: string;
    alreadySubmitted: boolean;
  }> {
    if (!token || !/^[0-9a-f-]{36}$/i.test(token)) {
      throw new NotFoundError('Review not found');
    }

    const review = await this.prisma.monthlyReview.findUnique({
      where: { feedbackToken: token },
      include: { student: { select: { name: true } } },
    });

    if (!review) throw new NotFoundError('Review not found');

    const existing = await this.prisma.serviceFeedback.findFirst({
      where: { reviewId: review.id },
      select: { id: true },
    });

    return {
      studentName: review.student.name,
      month: review.month,
      alreadySubmitted: !!existing,
    };
  }

  /** Submit feedback for a review identified by its token. */
  async submit(
    token: string,
    data: { rating: unknown; comment?: unknown; suggestion?: unknown },
  ): Promise<{
    id: number;
    reviewId: number;
    rating: number;
    comment: string | null;
    submittedAt: string;
  }> {
    if (!token || !/^[0-9a-f-]{36}$/i.test(token)) {
      throw new NotFoundError('Review not found');
    }

    const review = await this.prisma.monthlyReview.findUnique({
      where: { feedbackToken: token },
      include: { student: { select: { name: true } } },
    });

    if (!review) throw new NotFoundError('Review not found');

    const { rating, comment, suggestion } = data;

    if (
      rating === undefined ||
      rating === null ||
      !Number.isInteger(rating) ||
      (rating as number) < 1 ||
      (rating as number) > 5
    ) {
      throw new ValidationError('rating must be an integer between 1 and 5');
    }

    const existing = await this.prisma.serviceFeedback.findFirst({
      where: { reviewId: review.id },
      select: { id: true },
    });

    if (existing) throw new ConflictError('Feedback already submitted');

    const fb = await this.prisma.serviceFeedback.create({
      data: {
        reviewId: review.id,
        rating: rating as number,
        comment: typeof comment === 'string' ? comment : null,
        suggestion:
          typeof suggestion === 'string' && suggestion.trim() ? suggestion.trim() : null,
      },
    });

    // Create admin notification for new feedback
    await this.prisma.adminNotification.create({
      data: {
        message: `New feedback from guardian of ${review.student.name}`,
      },
    });

    return {
      id: fb.id,
      reviewId: fb.reviewId,
      rating: fb.rating,
      comment: fb.comment,
      submittedAt: (fb.submittedAt as Date).toISOString(),
    };
  }
}
