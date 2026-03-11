import type { ServiceSource } from '../contracts/index';

// Import the lazy-init prisma (the actual PrismaClient proxy)
import { prisma as defaultPrisma } from './prisma';

// Import existing service functions
import { initConfigCache, getConfig, getAllConfig, setConfig, exportConfig } from './config';
import { getCounter, incrementCounter, decrementCounter } from './counter';
import { logBuffer } from './logBuffer';
import { UserService } from './user.service';
import { PermissionsService } from './permissions.service';
import { SchedulerService } from './scheduler.service';
import { BackupService } from './backup.service';
import { SessionService } from './session.service';

export class ServiceRegistry {
  readonly source: ServiceSource;
  readonly users: UserService;
  readonly permissions: PermissionsService;
  readonly scheduler: SchedulerService;
  readonly backups: BackupService;
  readonly sessions: SessionService;

  private constructor(source: ServiceSource = 'UI') {
    this.source = source;
    this.users = new UserService(defaultPrisma);
    this.permissions = new PermissionsService(defaultPrisma);
    this.scheduler = new SchedulerService(defaultPrisma);
    this.backups = new BackupService(defaultPrisma);
    this.sessions = new SessionService(defaultPrisma);
  }

  static create(source?: ServiceSource): ServiceRegistry {
    return new ServiceRegistry(source);
  }

  // --- Config ---
  get config() {
    return { initCache: initConfigCache, get: getConfig, getAll: getAllConfig, set: setConfig, export: exportConfig };
  }

  // --- Counter ---
  get counter() {
    return { get: getCounter, increment: incrementCounter, decrement: decrementCounter };
  }

  // --- Logs ---
  get logs() {
    return logBuffer;
  }

  // --- Prisma (for direct DB access when needed) ---
  get prisma() {
    return defaultPrisma;
  }

  /**
   * Delete all business data from the database in FK-safe order.
   * Preserves system tables (Config, Session).
   */
  async clearAll(): Promise<void> {
    const p = this.prisma;
    await p.scheduledJob.deleteMany();
    await p.roleAssignmentPattern.deleteMany();
    await p.user.deleteMany();
    await p.counter.deleteMany();
  }
}
