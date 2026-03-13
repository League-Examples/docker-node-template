import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const execFileAsync = promisify(execFile);

/** Convert a DATABASE_URL to one that works inside the DB container (localhost:5432). */
function internalDbUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hostname = 'localhost';
    u.port = '5432';
    return u.toString();
  } catch {
    return url;
  }
}

/** Build an S3 client for DigitalOcean Spaces, or null if not configured. */
function buildS3Client(): S3Client | null {
  const endpoint = process.env.DO_SPACES_ENDPOINT;
  const key = process.env.DO_SPACES_KEY;
  const secret = process.env.DO_SPACES_SECRET;
  const region = process.env.DO_SPACES_REGION || 'sfo3';

  if (!endpoint || !key || !secret) return null;

  return new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId: key, secretAccessKey: secret },
    forcePathStyle: false,
  });
}

export class BackupService {
  private prisma: any;
  private backupDir: string;
  private s3: S3Client | null;
  private bucket: string;
  private s3Prefix: string;

  constructor(prisma: any) {
    this.prisma = prisma;
    this.backupDir = process.env.BACKUP_DIR || path.resolve(process.cwd(), 'data/backups');
    this.s3 = buildS3Client();
    this.bucket = process.env.DO_SPACES_BUCKET || '';
    this.s3Prefix = `${process.env.APP_SLUG || 'app'}/backups/`;
  }

  private async ensureDir() {
    await fs.mkdir(this.backupDir, { recursive: true });
  }

  private validateFilename(filename: string) {
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw new Error('Invalid filename');
    }
  }

  private get s3Configured(): boolean {
    return !!(this.s3 && this.bucket);
  }

  private async uploadToS3(filename: string, body: string): Promise<void> {
    if (!this.s3Configured) return;
    await this.s3!.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: `${this.s3Prefix}${filename}`,
      Body: body,
      ContentType: 'application/sql',
    }));
  }

  private async deleteFromS3(filename: string): Promise<void> {
    if (!this.s3Configured) return;
    await this.s3!.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: `${this.s3Prefix}${filename}`,
    }));
  }

  async createBackup(): Promise<{ filename: string; timestamp: string; size: number; s3: boolean }> {
    await this.ensureDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.sql`;
    const filepath = path.join(this.backupDir, filename);

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error('DATABASE_URL not set');

    const container = process.env.DB_CONTAINER || 'docker-node-template-db-1';
    const { stdout } = await execFileAsync('docker', ['exec', container, 'pg_dump', internalDbUrl(dbUrl)]);
    await fs.writeFile(filepath, stdout);
    const stats = await fs.stat(filepath);

    // Also upload to S3
    let s3Ok = false;
    if (this.s3Configured) {
      try {
        await this.uploadToS3(filename, stdout);
        s3Ok = true;
      } catch (err) {
        console.error('S3 upload failed:', err);
      }
    }

    return { filename, timestamp: new Date().toISOString(), size: stats.size, s3: s3Ok };
  }

  async listBackups(): Promise<Array<{ filename: string; size: number; created: string; s3: boolean }>> {
    await this.ensureDir();

    // Local backups
    const localFiles = await fs.readdir(this.backupDir);
    const backupMap = new Map<string, { filename: string; size: number; created: string; s3: boolean }>();
    for (const file of localFiles.filter(f => f.endsWith('.sql'))) {
      const stats = await fs.stat(path.join(this.backupDir, file));
      backupMap.set(file, { filename: file, size: stats.size, created: stats.birthtime.toISOString(), s3: false });
    }

    // Merge with S3 listing
    if (this.s3Configured) {
      try {
        const resp = await this.s3!.send(new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: this.s3Prefix,
        }));
        for (const obj of resp.Contents || []) {
          const key = obj.Key || '';
          const fname = key.replace(this.s3Prefix, '');
          if (!fname || !fname.endsWith('.sql')) continue;
          if (backupMap.has(fname)) {
            backupMap.get(fname)!.s3 = true;
          } else {
            backupMap.set(fname, {
              filename: fname,
              size: obj.Size || 0,
              created: obj.LastModified?.toISOString() || '',
              s3: true,
            });
          }
        }
      } catch (err) {
        console.error('S3 list failed:', err);
      }
    }

    return Array.from(backupMap.values()).sort((a, b) => b.created.localeCompare(a.created));
  }

  async restoreBackup(filename: string): Promise<{ success: boolean }> {
    this.validateFilename(filename);
    const filepath = path.join(this.backupDir, filename);

    let sql: string;
    try {
      await fs.access(filepath);
      sql = await fs.readFile(filepath, 'utf-8');
    } catch {
      // Try downloading from S3 if not available locally
      if (!this.s3Configured) throw new Error('Backup not found locally and S3 not configured');
      const resp = await this.s3!.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: `${this.s3Prefix}${filename}`,
      }));
      sql = await resp.Body!.transformToString();
      // Cache locally
      await this.ensureDir();
      await fs.writeFile(filepath, sql);
    }

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error('DATABASE_URL not set');
    const container = process.env.DB_CONTAINER || 'docker-node-template-db-1';
    await execFileAsync('docker', ['exec', '-i', container, 'psql', internalDbUrl(dbUrl)], { input: sql } as any);
    return { success: true };
  }

  async deleteBackup(filename: string): Promise<void> {
    this.validateFilename(filename);

    // Delete local
    const filepath = path.join(this.backupDir, filename);
    try {
      await fs.unlink(filepath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }

    // Delete from S3
    if (this.s3Configured) {
      try {
        await this.deleteFromS3(filename);
      } catch (err) {
        console.error('S3 delete failed:', err);
      }
    }
  }

  async exportJson(): Promise<any> {
    const [users, configs, rolePatterns, scheduledJobs, channels, messages] = await Promise.all([
      this.prisma.user.findMany(),
      this.prisma.config.findMany(),
      this.prisma.roleAssignmentPattern.findMany(),
      this.prisma.scheduledJob.findMany(),
      this.prisma.channel.findMany(),
      this.prisma.message.findMany(),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      tables: {
        User: { count: users.length, records: users },
        Config: { count: configs.length, records: configs },
        RoleAssignmentPattern: { count: rolePatterns.length, records: rolePatterns },
        ScheduledJob: { count: scheduledJobs.length, records: scheduledJobs },
        Channel: { count: channels.length, records: channels },
        Message: { count: messages.length, records: messages },
      },
    };
  }
}
