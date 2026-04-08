import { NotFoundError } from '../errors.js';

export interface StudentUpsertData {
  name: string;
  guardianEmail?: string | null;
  pike13SyncId?: string | null;
  githubUsername?: string | null;
}

export class StudentService {
  private prisma: any;

  constructor(prisma: any) {
    this.prisma = prisma;
  }

  /** Upsert a student by pike13SyncId. */
  async upsertByPike13Id(data: StudentUpsertData & { pike13SyncId: string }) {
    return this.prisma.student.upsert({
      where: { pike13SyncId: data.pike13SyncId },
      update: {
        name: data.name,
        guardianEmail: data.guardianEmail ?? null,
        githubUsername: data.githubUsername ?? null,
      },
      create: {
        name: data.name,
        guardianEmail: data.guardianEmail ?? null,
        pike13SyncId: data.pike13SyncId,
        githubUsername: data.githubUsername ?? null,
      },
    });
  }

  /** List all students. */
  async list() {
    return this.prisma.student.findMany({ orderBy: { name: 'asc' } });
  }

  /** Get a student by primary key. */
  async getById(id: number) {
    const student = await this.prisma.student.findUnique({ where: { id } });
    if (!student) throw new NotFoundError(`Student ${id} not found`);
    return student;
  }
}
