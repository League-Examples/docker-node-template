/** Returns the ISO date string for the Monday of the current week (UTC). */
function currentWeekMonday(): string {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun,1=Mon,...,6=Sat
  const daysToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + daysToMonday);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

export class CheckinService {
  private prisma: any;

  constructor(prisma: any) {
    this.prisma = prisma;
  }

  /**
   * Get pending TA check-in information for the current week.
   * Returns the week's Monday date, whether the instructor has already submitted,
   * and the list of TA entries (currently empty — populated in a future sprint).
   */
  async getPending(instructorId: number): Promise<{
    weekOf: string;
    alreadySubmitted: boolean;
    entries: Array<{ taName: string; wasPresent: boolean }>;
  }> {
    const weekOf = currentWeekMonday();

    const existing = await this.prisma.taCheckin.findMany({
      where: { instructorId, weekOf },
    });

    return {
      weekOf,
      alreadySubmitted: existing.length > 0,
      entries: [],
    };
  }

  /**
   * Batch upsert check-in entries for a given week.
   * Uses upsert to be idempotent on re-submissions.
   */
  async submit(
    instructorId: number,
    weekOf: string,
    entries: Array<{ taName: string; wasPresent: boolean }>,
  ): Promise<{ ok: boolean; weekOf: string; count: number }> {
    for (const entry of entries) {
      await this.prisma.taCheckin.upsert({
        where: {
          instructorId_taName_weekOf: {
            instructorId,
            taName: entry.taName,
            weekOf,
          },
        },
        update: { wasPresent: entry.wasPresent, submittedAt: new Date() },
        create: {
          instructorId,
          taName: entry.taName,
          weekOf,
          wasPresent: entry.wasPresent,
        },
      });
    }

    return { ok: true, weekOf, count: entries.length };
  }
}
