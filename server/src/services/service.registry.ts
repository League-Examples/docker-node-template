import type { ServiceSource } from '../contracts/index';

// Import the lazy-init prisma (the actual PrismaClient proxy)
import { prisma as defaultPrisma } from './prisma';

// Import existing service functions
import { initConfigCache, getConfig, getAllConfig, setConfig, exportConfig } from './config';
import { logBuffer } from './logBuffer';
import { UserService } from './user.service';
import { PermissionsService } from './permissions.service';
import { SchedulerService } from './scheduler.service';
import { BackupService } from './backup.service';
import { SessionService } from './session.service';

// Import LEAGUEhub domain services
import { InstructorService } from './instructor.service';
import { StudentService } from './student.service';
import { ReviewService } from './review.service';
import { TemplateService } from './template.service';
import { CheckinService } from './checkin.service';
import { FeedbackService } from './feedback.service';
import { EmailService } from './email.service';
import { Pike13SyncService } from './pike13-sync.service';
import { VolunteerService } from './volunteer.service';
import { ComplianceService } from './compliance.service';
import { NotificationService } from './notification.service';

export class ServiceRegistry {
  readonly source: ServiceSource;
  readonly users: UserService;
  readonly permissions: PermissionsService;
  readonly scheduler: SchedulerService;
  readonly backups: BackupService;
  readonly sessions: SessionService;

  // LEAGUEhub domain services
  readonly instructors: InstructorService;
  readonly students: StudentService;
  readonly reviews: ReviewService;
  readonly templates: TemplateService;
  readonly checkins: CheckinService;
  readonly feedback: FeedbackService;
  readonly email: EmailService;
  readonly pike13Sync: Pike13SyncService;
  readonly volunteers: VolunteerService;
  readonly compliance: ComplianceService;
  readonly notifications: NotificationService;

  private constructor(source: ServiceSource = 'UI') {
    this.source = source;
    this.users = new UserService(defaultPrisma);
    this.permissions = new PermissionsService(defaultPrisma);
    this.scheduler = new SchedulerService(defaultPrisma);
    this.backups = new BackupService(defaultPrisma);
    this.sessions = new SessionService(defaultPrisma);

    // LEAGUEhub domain services
    this.instructors = new InstructorService(defaultPrisma);
    this.students = new StudentService(defaultPrisma);
    this.reviews = new ReviewService(defaultPrisma);
    this.templates = new TemplateService(defaultPrisma);
    this.checkins = new CheckinService(defaultPrisma);
    this.feedback = new FeedbackService(defaultPrisma);
    this.email = new EmailService(defaultPrisma);
    this.pike13Sync = new Pike13SyncService(defaultPrisma);
    this.volunteers = new VolunteerService(defaultPrisma);
    this.compliance = new ComplianceService(defaultPrisma);
    this.notifications = new NotificationService(defaultPrisma);
  }

  static create(source?: ServiceSource): ServiceRegistry {
    return new ServiceRegistry(source);
  }

  // --- Config ---
  get config() {
    return { initCache: initConfigCache, get: getConfig, getAll: getAllConfig, set: setConfig, export: exportConfig };
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
    // LEAGUEhub tables (FK-safe order: children before parents)
    await p.serviceFeedback.deleteMany();
    await p.monthlyReview.deleteMany();
    await p.reviewTemplate.deleteMany();
    await p.taCheckin.deleteMany();
    await p.instructorStudent.deleteMany();
    await p.studentAttendance.deleteMany();
    await p.pike13Token.deleteMany();
    await p.adminNotification.deleteMany();
    await p.volunteerHour.deleteMany();
    await p.volunteerSchedule.deleteMany();
    await p.volunteerEventSchedule.deleteMany();
    await p.pike13AdminToken.deleteMany();
    await p.adminSetting.deleteMany();
    await p.student.deleteMany();
    await p.instructor.deleteMany();
    // Base tables
    await p.scheduledJob.deleteMany();
    await p.roleAssignmentPattern.deleteMany();
    await p.user.deleteMany();
  }
}
