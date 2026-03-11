import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
const execFileAsync = promisify(execFile);

export class BackupService {
  private prisma: any;
  private backupDir: string;

  constructor(prisma: any) {
    this.prisma = prisma;
    this.backupDir = process.env.BACKUP_DIR || path.resolve(process.cwd(), 'data/backups');
  }

  private async ensureDir() {
    await fs.mkdir(this.backupDir, { recursive: true });
  }

  private validateFilename(filename: string) {
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw new Error('Invalid filename');
    }
  }

  async createBackup(): Promise<{ filename: string; timestamp: string; size: number }> {
    await this.ensureDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.sql`;
    const filepath = path.join(this.backupDir, filename);

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error('DATABASE_URL not set');

    await execFileAsync('pg_dump', [dbUrl, '-f', filepath]);
    const stats = await fs.stat(filepath);
    return { filename, timestamp: new Date().toISOString(), size: stats.size };
  }

  async listBackups(): Promise<Array<{ filename: string; size: number; created: string }>> {
    await this.ensureDir();
    const files = await fs.readdir(this.backupDir);
    const backups = [];
    for (const file of files.filter(f => f.endsWith('.sql'))) {
      const stats = await fs.stat(path.join(this.backupDir, file));
      backups.push({ filename: file, size: stats.size, created: stats.birthtime.toISOString() });
    }
    return backups.sort((a, b) => b.created.localeCompare(a.created));
  }

  async restoreBackup(filename: string): Promise<{ success: boolean }> {
    this.validateFilename(filename);
    const filepath = path.join(this.backupDir, filename);
    await fs.access(filepath); // throws if missing
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error('DATABASE_URL not set');
    await execFileAsync('psql', [dbUrl, '-f', filepath]);
    return { success: true };
  }

  async deleteBackup(filename: string): Promise<void> {
    this.validateFilename(filename);
    const filepath = path.join(this.backupDir, filename);
    await fs.unlink(filepath);
  }

  async exportJson(): Promise<any> {
    const [users, counters, configs, rolePatterns, scheduledJobs] = await Promise.all([
      this.prisma.user.findMany(),
      this.prisma.counter.findMany(),
      this.prisma.config.findMany(),
      this.prisma.roleAssignmentPattern.findMany(),
      this.prisma.scheduledJob.findMany(),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      tables: {
        User: { count: users.length, records: users },
        Counter: { count: counters.length, records: counters },
        Config: { count: configs.length, records: configs },
        RoleAssignmentPattern: { count: rolePatterns.length, records: rolePatterns },
        ScheduledJob: { count: scheduledJobs.length, records: scheduledJobs },
      },
    };
  }
}
