export interface SessionListItem {
  sid: string;
  userEmail: string | null;
  userName: string | null;
  userRole: string | null;
  expires: Date;
  createdAt: Date | null;
}

interface SessionRow {
  sid: string;
  sess: Record<string, unknown>;
  expire: Date;
}

export class SessionService {
  private prisma: any;

  constructor(prisma: any) {
    this.prisma = prisma;
  }

  async list(): Promise<SessionListItem[]> {
    const sessions = await this.prisma.$queryRaw<SessionRow[]>`
      SELECT sid, sess, expire
      FROM session
      WHERE expire > NOW()
      ORDER BY expire DESC
    `;

    const items: SessionListItem[] = [];

    for (const s of sessions) {
      const sess = s.sess as Record<string, unknown>;
      let userId: number | null = null;

      // Extract user ID from passport session data
      if (sess.passport && typeof sess.passport === 'object') {
        const passport = sess.passport as Record<string, unknown>;
        if (passport.user && typeof passport.user === 'object') {
          const user = passport.user as Record<string, unknown>;
          if (typeof user.id === 'number') {
            userId = user.id;
          }
        }
      }

      let userEmail: string | null = null;
      let userName: string | null = null;
      let userRole: string | null = null;

      if (userId) {
        try {
          const dbUser = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { email: true, displayName: true, role: true },
          });
          if (dbUser) {
            userEmail = dbUser.email;
            userName = dbUser.displayName;
            userRole = dbUser.role;
          }
        } catch {
          // User may have been deleted; leave fields null
        }
      }

      items.push({
        sid: s.sid,
        userEmail,
        userName,
        userRole,
        expires: s.expire,
        createdAt: null, // session table has no createdAt column
      });
    }

    return items;
  }

  async count(): Promise<number> {
    const result = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM session WHERE expire > NOW()
    `;
    return Number(result[0].count);
  }

  async deleteExpired(): Promise<number> {
    const result = await this.prisma.$executeRaw`
      DELETE FROM session WHERE expire < NOW()
    `;
    return result;
  }
}
