export class MessageService {
  private prisma: any;

  constructor(prisma: any) {
    this.prisma = prisma;
  }

  async list(channelId: number, options?: { limit?: number; before?: number }) {
    const limit = options?.limit ?? 50;
    const where: any = { channelId };
    if (options?.before) {
      where.id = { lt: options.before };
    }

    return this.prisma.message.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: limit,
      include: {
        author: { select: { id: true, displayName: true, email: true, avatarUrl: true } },
      },
    });
  }

  async create(channelId: number, authorId: number, content: string) {
    return this.prisma.message.create({
      data: { channelId, authorId, content },
      include: {
        author: { select: { id: true, displayName: true, email: true, avatarUrl: true } },
      },
    });
  }

  async getById(id: number) {
    return this.prisma.message.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, displayName: true, email: true, avatarUrl: true } },
      },
    });
  }

  async delete(id: number) {
    return this.prisma.message.delete({ where: { id } });
  }
}
