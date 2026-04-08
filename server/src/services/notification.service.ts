import { NotFoundError } from '../errors.js';

export class NotificationService {
  private prisma: any;

  constructor(prisma: any) {
    this.prisma = prisma;
  }

  /** List notifications, optionally filtered to unread only. */
  async list(unreadOnly = false) {
    const rows = await this.prisma.adminNotification.findMany({
      where: unreadOnly ? { isRead: false } : undefined,
      include: { fromUser: { select: { displayName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((r: any) => ({
      id: r.id,
      fromUserName: r.fromUser?.displayName ?? r.fromUser?.email ?? null,
      message: r.message,
      isRead: r.isRead,
      createdAt: (r.createdAt as Date).toISOString(),
    }));
  }

  /** Mark a notification as read. */
  async markRead(id: number) {
    const existing = await this.prisma.adminNotification.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Notification not found');

    return this.prisma.adminNotification.update({
      where: { id },
      data: { isRead: true },
    });
  }

  /** Create a new notification (optionally attributed to a user). */
  async create(fromUserId: number | null, message: string) {
    return this.prisma.adminNotification.create({
      data: {
        fromUserId: fromUserId ?? null,
        message,
      },
    });
  }
}
