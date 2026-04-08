/** Returns the ISO date of the last Monday of a given YYYY-MM month. */
function lastMondayOfMonth(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  // Last day of the month
  const lastDay = new Date(year, mon, 0); // day 0 of next month = last day of this month
  const dow = lastDay.getDay(); // 0=Sun, 1=Mon, ...
  const daysBack = dow === 0 ? 6 : dow - 1; // days back to Monday
  const monday = new Date(lastDay);
  monday.setDate(lastDay.getDate() - daysBack);
  return monday.toISOString().slice(0, 10);
}

export interface ComplianceRow {
  instructorId: number;
  name: string;
  pending: number;
  draft: number;
  sent: number;
  recentCheckinSubmitted: boolean;
}

export interface ComplianceReport {
  month: string;
  rows: ComplianceRow[];
}

export class ComplianceService {
  private prisma: any;

  constructor(prisma: any) {
    this.prisma = prisma;
  }

  /** Get a per-instructor review completion report for a given month. */
  async getReport(month?: string): Promise<ComplianceReport> {
    const resolvedMonth =
      month && /^\d{4}-\d{2}$/.test(month)
        ? month
        : new Date().toISOString().slice(0, 7);

    const recentMonday = lastMondayOfMonth(resolvedMonth);

    // All active instructors with user names
    const allInstructors = await this.prisma.instructor.findMany({
      where: { isActive: true },
      include: { user: { select: { displayName: true, email: true } } },
    });

    // Review counts grouped by instructor and status
    const reviewGroups = await this.prisma.monthlyReview.groupBy({
      by: ['instructorId', 'status'],
      where: { month: resolvedMonth },
      _count: { id: true },
    });

    // Check-in submissions for the most recent Monday of the month
    const checkinRows = await this.prisma.taCheckin.findMany({
      where: { weekOf: recentMonday },
      select: { instructorId: true },
    });

    const checkinSet = new Set(checkinRows.map((r: any) => r.instructorId));

    // Build count map per instructor
    const countMap = new Map<number, { pending: number; draft: number; sent: number }>();
    for (const row of reviewGroups) {
      if (!countMap.has(row.instructorId)) {
        countMap.set(row.instructorId, { pending: 0, draft: 0, sent: 0 });
      }
      const key = (row.status as string).toLowerCase() as 'pending' | 'draft' | 'sent';
      countMap.get(row.instructorId)![key] = row._count.id;
    }

    const rows: ComplianceRow[] = allInstructors.map((i: any) => ({
      instructorId: i.id,
      name: i.user.displayName ?? i.user.email,
      pending: countMap.get(i.id)?.pending ?? 0,
      draft: countMap.get(i.id)?.draft ?? 0,
      sent: countMap.get(i.id)?.sent ?? 0,
      recentCheckinSubmitted: checkinSet.has(i.id),
    }));

    return { month: resolvedMonth, rows };
  }
}
