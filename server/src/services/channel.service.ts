export class ChannelService {
  private prisma: any;

  constructor(prisma: any) {
    this.prisma = prisma;
  }

  async list() {
    return this.prisma.channel.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { messages: true } },
      },
    });
  }

  async get(id: number, options?: { limit?: number; before?: number }) {
    const limit = options?.limit ?? 50;
    const where: any = { channelId: id };
    if (options?.before) {
      where.id = { lt: options.before };
    }

    const [channel, messages] = await Promise.all([
      this.prisma.channel.findUnique({ where: { id } }),
      this.prisma.message.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          author: { select: { id: true, displayName: true, email: true, avatarUrl: true } },
        },
      }),
    ]);

    if (!channel) return null;

    return { ...channel, messages: messages.reverse() };
  }

  async create(name: string, description?: string) {
    return this.prisma.channel.create({
      data: { name, description },
    });
  }

  async delete(id: number) {
    return this.prisma.channel.delete({ where: { id } });
  }
}
