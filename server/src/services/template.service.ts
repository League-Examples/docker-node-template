import { NotFoundError } from '../errors.js';

export interface TemplateFormatted {
  id: number;
  name: string;
  subject: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

function formatTemplate(t: any): TemplateFormatted {
  return {
    id: t.id,
    name: t.name,
    subject: t.subject,
    body: t.body,
    createdAt: (t.createdAt as Date).toISOString(),
    updatedAt: (t.updatedAt as Date).toISOString(),
  };
}

export class TemplateService {
  private prisma: any;

  constructor(prisma: any) {
    this.prisma = prisma;
  }

  /** List all templates for an instructor. */
  async list(instructorId: number): Promise<TemplateFormatted[]> {
    const rows = await this.prisma.reviewTemplate.findMany({
      where: { instructorId },
      orderBy: { name: 'asc' },
    });
    return rows.map(formatTemplate);
  }

  /** Create a new review template. */
  async create(
    instructorId: number,
    data: { name: string; subject: string; body: string },
  ): Promise<TemplateFormatted> {
    const tmpl = await this.prisma.reviewTemplate.create({
      data: { instructorId, ...data },
    });
    return formatTemplate(tmpl);
  }

  /** Update an existing review template. */
  async update(
    id: number,
    instructorId: number,
    data: { name?: string; subject?: string; body?: string },
  ): Promise<TemplateFormatted> {
    const existing = await this.prisma.reviewTemplate.findFirst({
      where: { id, instructorId },
    });
    if (!existing) throw new NotFoundError('Template not found');

    const updated = await this.prisma.reviewTemplate.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.subject !== undefined && { subject: data.subject }),
        ...(data.body !== undefined && { body: data.body }),
      },
    });
    return formatTemplate(updated);
  }

  /** Delete a review template. */
  async delete(id: number, instructorId: number): Promise<void> {
    const existing = await this.prisma.reviewTemplate.findFirst({
      where: { id, instructorId },
    });
    if (!existing) throw new NotFoundError('Template not found');
    await this.prisma.reviewTemplate.delete({ where: { id } });
  }
}
