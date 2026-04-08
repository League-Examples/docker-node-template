/** Pike13 custom field key for the student's GitHub account name */
export const PIKE13_GITHUB_FIELD_KEY = 'github_acct_name';

/** Normalize a field name for loose comparison: lowercase, strip all non-alphanumeric chars. */
function normalizeFieldName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const GITHUB_FIELD_NORMALIZED = normalizeFieldName(PIKE13_GITHUB_FIELD_KEY);

export interface SyncResult {
  studentsUpserted: number;
  instructorsUpserted: number;
  assignmentsCreated: number;
  hoursCreated: number;
}

// ---- Pike13 API response shapes ----

interface Pike13Person {
  id: number;
  name: string;
  email?: string;
  custom_fields?: Array<{ name: string; value: string | null }>;
}

interface Pike13StaffMember {
  id: number;
  name: string;
  email?: string;
}

interface Pike13EventOccurrence {
  id: number;
  start_at: string;
  end_at: string;
  staff_members?: Array<{ id: number; name: string }>;
  people?: Array<{ id?: number; name?: string; visit_state?: string }>;
}

// ---- Fetch helpers ----

async function fetchPike13<T>(
  url: string,
  key: string,
  accessToken: string,
  fetchFn: typeof fetch,
): Promise<T[]> {
  const res = await fetchFn(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Pike13 API returned ${res.status} for ${url}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  return (data[key] as T[]) ?? [];
}

async function fetchPike13All<T>(
  initialUrl: string,
  key: string,
  accessToken: string,
  fetchFn: typeof fetch,
): Promise<T[]> {
  const results: T[] = [];
  let url: string | null = initialUrl;
  while (url) {
    const res = await fetchFn(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Pike13 API returned ${res.status} for ${url}`);
    const data = (await res.json()) as Record<string, unknown>;
    const page = (data[key] as T[]) ?? [];
    results.push(...page);
    url = (data['next'] as string | null | undefined) ?? null;
  }
  return results;
}

const isTaOrVa = (name: string) => /^(TA|VA)[\s\-]/i.test(name);

export class Pike13SyncService {
  private prisma: any;

  constructor(prisma: any) {
    this.prisma = prisma;
  }

  /**
   * Run a full Pike13 sync using the provided access token.
   * Gracefully no-ops when Pike13 credentials are not configured.
   */
  async runSync(
    accessToken: string,
    fetchFn: typeof fetch = fetch,
  ): Promise<SyncResult> {
    if (!process.env.PIKE13_BASE_URL && !process.env.PIKE13_CLIENT_ID) {
      console.warn('[Pike13SyncService] Pike13 credentials not configured — skipping sync');
      return { studentsUpserted: 0, instructorsUpserted: 0, assignmentsCreated: 0, hoursCreated: 0 };
    }

    const base = (process.env.PIKE13_BASE_URL ?? 'https://pike13.com').replace(/\/$/, '');
    const ytdStart = `${new Date().getFullYear()}-01-01`;
    const now = new Date();

    // 1. Get all staff from desk/staff_members
    const allStaff = await fetchPike13<Pike13StaffMember>(
      `${base}/api/v2/desk/staff_members?per_page=200`,
      'staff_members',
      accessToken,
      fetchFn,
    );
    const instructorStaff = allStaff.filter((s) => !isTaOrVa(s.name) && s.email);

    // 2. Upsert a user + instructor record for every Pike13 instructor staff member
    let instructorsUpserted = 0;
    for (const staff of instructorStaff) {
      const email = staff.email!.toLowerCase();

      let existingUser = await this.prisma.user.findUnique({ where: { email } });
      let userId: number;

      if (existingUser) {
        userId = existingUser.id;
        if (existingUser.displayName !== staff.name) {
          await this.prisma.user.update({
            where: { id: userId },
            data: { displayName: staff.name },
          });
        }
      } else {
        const newUser = await this.prisma.user.create({
          data: { email, displayName: staff.name },
        });
        userId = newUser.id;
      }

      const existingInstructor = await this.prisma.instructor.findUnique({
        where: { userId },
      });

      if (!existingInstructor) {
        await this.prisma.instructor.create({ data: { userId, isActive: true } });
      } else if (!existingInstructor.isActive) {
        await this.prisma.instructor.update({
          where: { id: existingInstructor.id },
          data: { isActive: true },
        });
      }
      instructorsUpserted++;
    }

    // 2b. VA/TA → instructor transition: rename old volunteer_hours entries
    for (const staff of instructorStaff) {
      const possibleOldNames = [
        `TA-${staff.name}`, `TA ${staff.name}`,
        `VA-${staff.name}`, `VA ${staff.name}`,
      ];
      for (const oldName of possibleOldNames) {
        await this.prisma.volunteerHour.updateMany({
          where: { volunteerName: oldName, source: 'pike13' },
          data: { volunteerName: staff.name },
        });
      }
    }

    // 3. Build pike13StaffId → instructorId map via email lookup
    const instructorRows = await this.prisma.instructor.findMany({
      include: { user: { select: { email: true } } },
    });

    const emailToInstructorId = new Map<string, number>(
      instructorRows.map((r: any) => [r.user.email.toLowerCase(), r.id]),
    );

    const pike13StaffIdToInstructorId = new Map<number, number>();
    for (const staff of allStaff) {
      if (!staff.email) continue;
      const instructorId = emailToInstructorId.get(staff.email.toLowerCase());
      if (instructorId !== undefined) {
        pike13StaffIdToInstructorId.set(staff.id, instructorId);
      }
    }

    const volunteerStaff = allStaff.filter((s) => !pike13StaffIdToInstructorId.has(s.id));

    // 4. Fetch YTD event occurrences in weekly chunks
    const eventOccurrences: Pike13EventOccurrence[] = [];
    const chunkStart = new Date(ytdStart);
    while (chunkStart <= now) {
      const chunkEnd = new Date(chunkStart);
      chunkEnd.setDate(chunkEnd.getDate() + 6);
      const from = chunkStart.toISOString().slice(0, 10);
      const to = chunkEnd.toISOString().slice(0, 10);
      const chunk = await fetchPike13<Pike13EventOccurrence>(
        `${base}/api/v2/desk/event_occurrences?from=${from}&to=${to}&per_page=200`,
        'event_occurrences',
        accessToken,
        fetchFn,
      );
      eventOccurrences.push(...chunk);
      chunkStart.setDate(chunkStart.getDate() + 7);
    }

    // 5. Fetch upcoming events (next 4 weeks)
    const futureEnd = new Date(now);
    futureEnd.setDate(futureEnd.getDate() + 28);
    const upcomingEvents = await fetchPike13<Pike13EventOccurrence>(
      `${base}/api/v2/desk/event_occurrences?from=${now.toISOString().slice(0, 10)}&to=${futureEnd.toISOString().slice(0, 10)}&per_page=200`,
      'event_occurrences',
      accessToken,
      fetchFn,
    );

    // 6. Volunteer scheduled status from upcoming events
    const scheduledNames = new Set<string>();
    for (const occ of upcomingEvents) {
      for (const staff of occ.staff_members ?? []) {
        if (!pike13StaffIdToInstructorId.has(staff.id)) scheduledNames.add(staff.name);
      }
    }

    // 6b. Build instructor student count map
    const instructorStudentGroups = await this.prisma.instructorStudent.groupBy({
      by: ['instructorId'],
      _count: { studentId: true },
    });
    const instructorStudentCountMap = new Map<number, number>(
      instructorStudentGroups.map((r: any) => [r.instructorId, r._count.studentId]),
    );

    // 6c. Upsert upcoming event schedule data
    for (const occ of upcomingEvents) {
      const instrList: Array<{
        pike13Id: number;
        name: string;
        instructorId: number | null;
        studentCount: number;
      }> = [];
      const volList: Array<{ pike13Id: number; name: string }> = [];

      for (const staff of occ.staff_members ?? []) {
        const instructorId = pike13StaffIdToInstructorId.get(staff.id) ?? null;
        if (instructorId !== null) {
          instrList.push({
            pike13Id: staff.id,
            name: staff.name,
            instructorId,
            studentCount: instructorStudentCountMap.get(instructorId) ?? 0,
          });
        } else {
          volList.push({ pike13Id: staff.id, name: staff.name });
        }
      }

      if (instrList.length === 0) continue;

      await this.prisma.volunteerEventSchedule.upsert({
        where: { eventOccurrenceId: String(occ.id) },
        update: {
          startAt: new Date(occ.start_at),
          endAt: new Date(occ.end_at),
          instructors: instrList,
          volunteers: volList,
        },
        create: {
          eventOccurrenceId: String(occ.id),
          startAt: new Date(occ.start_at),
          endAt: new Date(occ.end_at),
          instructors: instrList,
          volunteers: volList,
        },
      });
    }

    // Delete stale past events
    await this.prisma.volunteerEventSchedule.deleteMany({
      where: { startAt: { lt: new Date() } },
    });

    // 7. Clean up duplicate volunteer hours (same volunteer, same recorded_at, keep lowest id)
    // Prisma doesn't support CTEs directly — use raw query for SQLite/PG compat via $queryRaw
    // We use application-level dedup instead to stay ORM-only
    const dupGroups = await this.prisma.volunteerHour.groupBy({
      by: ['volunteerName', 'recordedAt', 'source'],
      where: { source: 'pike13' },
      having: { volunteerName: { _count: { gt: 1 } } },
    });

    for (const group of dupGroups) {
      const dups = await this.prisma.volunteerHour.findMany({
        where: {
          volunteerName: group.volunteerName,
          recordedAt: group.recordedAt,
          source: 'pike13',
        },
        orderBy: { id: 'asc' },
        select: { id: true },
      });
      // Keep the first (lowest id), delete the rest
      if (dups.length > 1) {
        await this.prisma.volunteerHour.deleteMany({
          where: { id: { in: dups.slice(1).map((d: any) => d.id) } },
        });
      }
    }

    // Process volunteer hours from YTD events
    const countedSlots = new Set<string>();
    let hoursCreated = 0;

    for (const occ of eventOccurrences) {
      const start = new Date(occ.start_at);
      const end = new Date(occ.end_at);
      const hours = Math.max(0, (end.getTime() - start.getTime()) / 3_600_000);

      for (const staff of occ.staff_members ?? []) {
        if (pike13StaffIdToInstructorId.has(staff.id)) continue;

        const slotKey = `${staff.id}|${occ.start_at}`;
        if (countedSlots.has(slotKey)) continue;
        countedSlots.add(slotKey);

        const externalId = `${occ.id}-${staff.id}`;

        // onConflictDoNothing equivalent: try create, catch unique constraint
        try {
          await this.prisma.volunteerHour.create({
            data: {
              volunteerName: staff.name,
              category: 'Teaching',
              hours,
              source: 'pike13',
              externalId,
              recordedAt: start,
            },
          });
          hoursCreated++;
        } catch (err: any) {
          // P2002 = unique constraint violation — already exists, skip
          if (err.code !== 'P2002') throw err;
        }
      }
    }

    // 8. Upsert volunteer_schedule for all volunteer staff
    for (const staff of volunteerStaff) {
      await this.prisma.volunteerSchedule.upsert({
        where: { volunteerName: staff.name },
        update: { isScheduled: scheduledNames.has(staff.name) },
        create: { volunteerName: staff.name, isScheduled: scheduledNames.has(staff.name) },
      });
    }

    // 9. Sync all people as students
    const allPeople = await fetchPike13All<Pike13Person>(
      `${base}/api/v2/desk/people?per_page=100`,
      'people',
      accessToken,
      fetchFn,
    );

    const pike13IdToStudentId = new Map<number, number>();
    let studentsUpserted = 0;

    for (const person of allPeople) {
      const githubUsername =
        person.custom_fields?.find(
          (f) => normalizeFieldName(f.name) === GITHUB_FIELD_NORMALIZED,
        )?.value ?? null;

      const student = await this.prisma.student.upsert({
        where: { pike13SyncId: String(person.id) },
        update: {
          name: person.name,
          guardianEmail: person.email ?? null,
          githubUsername,
        },
        create: {
          name: person.name,
          guardianEmail: person.email ?? null,
          pike13SyncId: String(person.id),
          githubUsername,
        },
      });

      pike13IdToStudentId.set(person.id, student.id);
      studentsUpserted++;
    }

    // 10. Instructor-student assignments from event people (confirmed attendance only)
    let assignmentsCreated = 0;

    for (const occ of eventOccurrences) {
      const instructorIds: number[] = [];
      for (const staff of occ.staff_members ?? []) {
        if (isTaOrVa(staff.name)) continue;
        const instructorId = pike13StaffIdToInstructorId.get(staff.id);
        if (instructorId !== undefined) instructorIds.push(instructorId);
      }
      if (instructorIds.length === 0) continue;

      for (const person of occ.people ?? []) {
        if (!person.id || !person.name) continue;
        if (person.visit_state !== 'completed') continue;

        const personId = person.id as number;
        let studentId: number | undefined = pike13IdToStudentId.get(personId);
        if (studentId === undefined) {
          const student = await this.prisma.student.upsert({
            where: { pike13SyncId: String(personId) },
            update: { name: person.name },
            create: { name: person.name, pike13SyncId: String(personId) },
          });
          const newStudentId: number = student.id;
          pike13IdToStudentId.set(personId, newStudentId);
          studentId = newStudentId;
          studentsUpserted++;
        }

        const occStart = new Date(occ.start_at);
        const occurrenceId = String(occ.id);

        for (const instructorId of instructorIds) {
          await this.prisma.instructorStudent.upsert({
            where: { instructorId_studentId: { instructorId, studentId } },
            update: { lastSeenAt: occStart },
            create: { instructorId, studentId, lastSeenAt: occStart },
          });
          assignmentsCreated++;

          // Record individual attendance session
          try {
            await this.prisma.studentAttendance.create({
              data: { studentId, instructorId, attendedAt: occStart, eventOccurrenceId: occurrenceId },
            });
          } catch (err: any) {
            if (err.code !== 'P2002') throw err;
          }
        }
      }
    }

    return { studentsUpserted, instructorsUpserted, assignmentsCreated, hoursCreated };
  }
}
