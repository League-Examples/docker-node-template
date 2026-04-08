import { NotFoundError, ForbiddenError } from '../errors.js';

export interface VolunteerHourFilters {
  volunteerName?: string;
  category?: string;
  from?: string;
  to?: string;
}

export interface VolunteerHourData {
  volunteerName: string;
  category: string;
  hours: number;
  description?: string;
  recordedAt?: string;
}

export class VolunteerService {
  private prisma: any;

  constructor(prisma: any) {
    this.prisma = prisma;
  }

  /** List volunteer hours with optional filters. */
  async list(filters?: VolunteerHourFilters) {
    const where: Record<string, any> = {
      volunteerName: { startsWith: 'TA', mode: 'insensitive' },
    };

    // Application-level TA/VA filter since Prisma doesn't support regex in SQLite
    const rows = await this.prisma.volunteerHour.findMany({
      where: {
        ...(filters?.category && { category: filters.category }),
        ...(filters?.from || filters?.to
          ? {
              recordedAt: {
                ...(filters.from && { gte: new Date(filters.from) }),
                ...(filters.to && { lte: new Date(filters.to) }),
              },
            }
          : {}),
        ...(filters?.volunteerName && {
          volunteerName: { contains: filters.volunteerName },
        }),
      },
      orderBy: { recordedAt: 'asc' },
    });

    // Filter to TA/VA prefix (regex equivalent of `^(TA|VA)[\s\-]`)
    return rows.filter((r: any) => /^(TA|VA)[\s\-]/i.test(r.volunteerName));
  }

  /**
   * Get aggregate hours by volunteer name.
   * Starts from volunteerSchedule so all TA/VA volunteers appear even with zero hours.
   */
  async getSummary(from?: string, to?: string) {
    const fromDate = from ? new Date(from) : new Date(new Date().getFullYear(), 0, 1);
    const toDate = to ? new Date(to) : new Date();

    // Get all volunteer schedules with TA/VA prefix (application-level filter)
    const schedules = await this.prisma.volunteerSchedule.findMany();
    const taVaSchedules = schedules.filter((s: any) => /^(TA|VA)[\s\-]/i.test(s.volunteerName));

    // Get hours in date range
    const hoursRows = await this.prisma.volunteerHour.findMany({
      where: {
        recordedAt: { gte: fromDate, lte: toDate },
      },
    });

    // Build name → total hours map
    const hoursMap = new Map<string, number>();
    for (const row of hoursRows) {
      const current = hoursMap.get(row.volunteerName) ?? 0;
      hoursMap.set(row.volunteerName, current + row.hours);
    }

    // Merge schedules with hours
    return taVaSchedules
      .map((s: any) => ({
        volunteerName: s.volunteerName,
        totalHours: hoursMap.get(s.volunteerName) ?? 0,
        isScheduled: s.isScheduled,
      }))
      .sort((a: any, b: any) => b.totalHours - a.totalHours);
  }

  /** Create a volunteer hour entry. */
  async create(data: VolunteerHourData) {
    return this.prisma.volunteerHour.create({
      data: {
        volunteerName: data.volunteerName,
        category: data.category,
        hours: data.hours,
        description: data.description ?? null,
        recordedAt: data.recordedAt ? new Date(data.recordedAt) : new Date(),
        source: 'manual',
      },
    });
  }

  /** Update a volunteer hour entry. */
  async update(id: number, data: Partial<VolunteerHourData>) {
    const existing = await this.prisma.volunteerHour.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Entry not found');

    return this.prisma.volunteerHour.update({
      where: { id },
      data: {
        ...(data.volunteerName !== undefined && { volunteerName: data.volunteerName }),
        ...(data.category !== undefined && { category: data.category }),
        ...(data.hours !== undefined && { hours: data.hours }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.recordedAt !== undefined && { recordedAt: new Date(data.recordedAt) }),
      },
    });
  }

  /** Delete a volunteer hour entry (cannot delete Pike13-sourced entries). */
  async delete(id: number): Promise<void> {
    const existing = await this.prisma.volunteerHour.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Entry not found');
    if (existing.source === 'pike13') {
      throw new ForbiddenError('Cannot delete Pike13-sourced entries');
    }
    await this.prisma.volunteerHour.delete({ where: { id } });
  }
}
