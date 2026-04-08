import { NotFoundError } from '../errors.js';

export class InstructorService {
  private prisma: any;

  constructor(prisma: any) {
    this.prisma = prisma;
  }

  /** List all instructors with their user data. */
  async list() {
    return this.prisma.instructor.findMany({
      include: { user: true },
      orderBy: { id: 'asc' },
    });
  }

  /** Find an instructor record by user ID. */
  async getByUserId(userId: number) {
    return this.prisma.instructor.findUnique({ where: { userId } });
  }

  /** Create an instructor record for a user. */
  async create(userId: number) {
    return this.prisma.instructor.create({ data: { userId } });
  }

  /** Activate an instructor. */
  async activate(id: number) {
    const updated = await this.prisma.instructor.update({
      where: { id },
      data: { isActive: true },
    });
    if (!updated) throw new NotFoundError(`Instructor ${id} not found`);
    return updated;
  }

  /** Deactivate an instructor. */
  async deactivate(id: number) {
    const updated = await this.prisma.instructor.update({
      where: { id },
      data: { isActive: false },
    });
    if (!updated) throw new NotFoundError(`Instructor ${id} not found`);
    return updated;
  }

  /**
   * Get students for an instructor, optionally with review status for a given month.
   * Falls back to all assigned students when attendance table is empty.
   */
  async getStudents(
    instructorId: number,
    month?: string,
  ): Promise<
    Array<{
      id: number;
      name: string;
      githubUsername: string | null;
      attendanceDates: string[];
    }>
  > {
    let year: number;
    let mon: number;

    if (month && /^\d{4}-\d{2}$/.test(month)) {
      [year, mon] = month.split('-').map(Number);
    } else {
      const now = new Date();
      year = now.getFullYear();
      mon = now.getMonth() + 1;
    }

    const monthStart = new Date(year, mon - 1, 1);
    const monthEnd = new Date(year, mon, 1);

    const attendanceRows = await this.prisma.studentAttendance.findMany({
      where: {
        instructorId,
        attendedAt: { gte: monthStart, lt: monthEnd },
      },
      include: { student: { select: { id: true, name: true, githubUsername: true } } },
      orderBy: [{ student: { name: 'asc' } }, { attendedAt: 'asc' }],
    });

    if (attendanceRows.length === 0) {
      // Fallback: return all assigned students with empty attendance
      const fallback = await this.prisma.instructorStudent.findMany({
        where: { instructorId },
        include: { student: { select: { id: true, name: true, githubUsername: true } } },
        orderBy: { student: { name: 'asc' } },
      });
      return fallback.map((r: any) => ({
        id: r.student.id,
        name: r.student.name,
        githubUsername: r.student.githubUsername,
        attendanceDates: [],
      }));
    }

    // Group dates by student
    const studentMap = new Map<
      number,
      { id: number; name: string; githubUsername: string | null; attendanceDates: string[] }
    >();

    for (const row of attendanceRows) {
      const sid = row.student.id;
      if (!studentMap.has(sid)) {
        studentMap.set(sid, {
          id: sid,
          name: row.student.name,
          githubUsername: row.student.githubUsername,
          attendanceDates: [],
        });
      }
      studentMap.get(sid)!.attendanceDates.push(
        (row.attendedAt as Date).toISOString().slice(0, 10),
      );
    }

    return [...studentMap.values()];
  }

  /** Get review status counts for an instructor in a given month. */
  async getDashboard(
    instructorId: number,
    month: string,
  ): Promise<{
    month: string;
    totalStudents: number;
    pending: number;
    draft: number;
    sent: number;
  }> {
    const resolvedMonth =
      month && /^\d{4}-\d{2}$/.test(month)
        ? month
        : new Date().toISOString().slice(0, 7);

    const reviews = await this.prisma.monthlyReview.findMany({
      where: { instructorId, month: resolvedMonth },
      select: { status: true },
    });

    const counts = { pending: 0, draft: 0, sent: 0 };
    for (const r of reviews) {
      const key = r.status.toLowerCase() as keyof typeof counts;
      if (key in counts) counts[key]++;
    }

    const totalStudents = await this.prisma.instructorStudent.count({
      where: { instructorId },
    });

    return { month: resolvedMonth, totalStudents, ...counts };
  }
}
