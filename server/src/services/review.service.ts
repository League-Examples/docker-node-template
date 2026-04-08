import { NotFoundError, ConflictError, ValidationError } from '../errors.js';

export interface ReviewFormatted {
  id: number;
  studentId: number;
  studentName: string;
  githubUsername: string | null;
  month: string;
  status: string;
  subject: string | null;
  body: string | null;
  sentAt: string | null;
  feedbackToken: string;
  createdAt: string;
  updatedAt: string;
}

function formatReview(review: any, studentName: string, githubUsername: string | null = null): ReviewFormatted {
  return {
    id: review.id,
    studentId: review.studentId,
    studentName,
    githubUsername,
    month: review.month,
    status: review.status.toLowerCase(),
    subject: review.subject,
    body: review.body,
    sentAt: review.sentAt ? (review.sentAt as Date).toISOString() : null,
    feedbackToken: review.feedbackToken,
    createdAt: (review.createdAt as Date).toISOString(),
    updatedAt: (review.updatedAt as Date).toISOString(),
  };
}

export class ReviewService {
  private prisma: any;

  constructor(prisma: any) {
    this.prisma = prisma;
  }

  /** List all reviews for an instructor in a given month. */
  async list(instructorId: number, month?: string): Promise<ReviewFormatted[]> {
    const resolvedMonth =
      month && /^\d{4}-\d{2}$/.test(month)
        ? month
        : new Date().toISOString().slice(0, 7);

    const rows = await this.prisma.monthlyReview.findMany({
      where: { instructorId, month: resolvedMonth },
      include: { student: { select: { name: true, githubUsername: true } } },
    });

    return rows.map((r: any) => formatReview(r, r.student.name, r.student.githubUsername));
  }

  /** Get a single review by ID, scoped to an instructor. */
  async getById(id: number, instructorId: number): Promise<ReviewFormatted> {
    const row = await this.prisma.monthlyReview.findFirst({
      where: { id, instructorId },
      include: { student: { select: { name: true, githubUsername: true } } },
    });

    if (!row) throw new NotFoundError('Review not found');
    return formatReview(row, row.student.name, row.student.githubUsername);
  }

  /** Create a review for an instructor/student/month combination (idempotent). */
  async create(
    instructorId: number,
    studentId: number,
    month: string,
  ): Promise<{ review: ReviewFormatted; created: boolean }> {
    const student = await this.prisma.student.findUnique({ where: { id: studentId } });
    if (!student) throw new NotFoundError('Student not found');

    try {
      const review = await this.prisma.monthlyReview.create({
        data: { instructorId, studentId, month },
      });
      return { review: formatReview(review, student.name), created: true };
    } catch (err: any) {
      // Unique constraint violation — row already exists
      if (err.code === 'P2002') {
        const existing = await this.prisma.monthlyReview.findUnique({
          where: {
            instructorId_studentId_month: { instructorId, studentId, month },
          },
        });
        return { review: formatReview(existing, student.name), created: false };
      }
      throw err;
    }
  }

  /** Update review subject/body/status. Cannot edit a sent review. */
  async update(
    id: number,
    instructorId: number,
    data: { subject?: string; body?: string },
  ): Promise<ReviewFormatted> {
    const existing = await this.prisma.monthlyReview.findFirst({
      where: { id, instructorId },
      include: { student: { select: { name: true } } },
    });

    if (!existing) throw new NotFoundError('Review not found');
    if (existing.status === 'SENT') throw new ConflictError('Cannot edit a sent review');

    const updated = await this.prisma.monthlyReview.update({
      where: { id },
      data: {
        subject: data.subject,
        body: data.body,
        status: 'DRAFT',
      },
    });

    return formatReview(updated, existing.student.name);
  }

  /**
   * Mark a review as sent and return it. Email sending is left to the caller.
   * Returns the updated review and the guardian email for the caller to use.
   */
  async send(
    id: number,
    instructorId: number,
  ): Promise<{
    review: ReviewFormatted;
    guardianEmail: string | null;
    alreadySent: boolean;
  }> {
    const existing = await this.prisma.monthlyReview.findFirst({
      where: { id, instructorId },
      include: { student: { select: { name: true, guardianEmail: true } } },
    });

    if (!existing) throw new NotFoundError('Review not found');

    if (existing.status === 'SENT') {
      return {
        review: formatReview(existing, existing.student.name),
        guardianEmail: existing.student.guardianEmail,
        alreadySent: true,
      };
    }

    const now = new Date();
    const updated = await this.prisma.monthlyReview.update({
      where: { id },
      data: { status: 'SENT', sentAt: now },
    });

    return {
      review: formatReview(updated, existing.student.name),
      guardianEmail: existing.student.guardianEmail,
      alreadySent: false,
    };
  }

  /**
   * Generate a draft review body via Groq AI based on the student's GitHub activity.
   * Returns null gracefully when GROQ_API_KEY is not set.
   */
  async generateDraft(
    id: number,
    instructorId: number,
  ): Promise<{
    body: string;
    commitCount: number;
    repoCount: number;
  } | null> {
    if (!process.env.GROQ_API_KEY) {
      return null;
    }

    const row = await this.prisma.monthlyReview.findFirst({
      where: { id, instructorId },
      include: {
        student: {
          select: {
            name: true,
            githubUsername: true,
            guardianName: true,
          },
        },
        instructor: {
          include: {
            user: { select: { displayName: true, email: true } },
          },
        },
      },
    });

    if (!row) throw new NotFoundError('Review not found');
    if (!row.student.githubUsername) {
      throw new ValidationError('This student has no GitHub username linked in Pike13');
    }

    const { githubUsername, guardianName } = row.student;
    const studentName = row.student.name;
    const instructorName = row.instructor.user.displayName ?? row.instructor.user.email;
    const instructorEmail = row.instructor.user.email;
    const month = row.month;

    const reviewMonthYear = month.split('-');
    const reviewYear = parseInt(reviewMonthYear[0], 10);
    const reviewMon = parseInt(reviewMonthYear[1], 10);
    const monthLabel = new Date(Date.UTC(reviewYear, reviewMon - 1, 15)).toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });

    const now = new Date();
    const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const ghHeaders: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'LEAGUE-Review-App',
    };
    if (process.env.GITHUB_TOKEN) {
      ghHeaders['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const ghRes = await fetch(
      `https://api.github.com/users/${encodeURIComponent(githubUsername)}/events?per_page=100`,
      { headers: ghHeaders },
    );

    if (ghRes.status === 404) {
      throw new ValidationError(`GitHub user "${githubUsername}" not found`);
    }
    if (!ghRes.ok) {
      throw new Error(`GitHub API returned ${ghRes.status}`);
    }

    interface GithubEvent {
      type: string;
      created_at: string;
      repo: { name: string };
      payload: { ref?: string; commits?: Array<{ sha: string; message: string }> };
    }

    const events = (await ghRes.json()) as GithubEvent[];

    const pushEvents = events.filter((e) => {
      if (e.type !== 'PushEvent') return false;
      const d = new Date(e.created_at);
      return d >= since && d <= now;
    });

    if (pushEvents.length === 0) {
      throw new ValidationError(
        `No GitHub push activity found for @${githubUsername} in the past 30 days`,
      );
    }

    interface EnrichedCommit {
      sha: string;
      message: string;
      filesChanged: string[];
      additions: number;
      deletions: number;
    }
    interface RepoData {
      shortName: string;
      commits: EnrichedCommit[];
    }

    const repoData = new Map<string, RepoData>();

    for (const event of pushEvents) {
      const fullRepo = event.repo.name;
      const shortName = fullRepo.split('/').pop() ?? fullRepo;
      if (!repoData.has(fullRepo)) repoData.set(fullRepo, { shortName, commits: [] });
      const entry = repoData.get(fullRepo)!;
      for (const c of event.payload.commits ?? []) {
        const msg = (c.message ?? '').split('\n')[0].trim();
        if (!msg || msg.toLowerCase().startsWith('merge ')) continue;
        const sha = (c.sha ?? '').slice(0, 7);
        if (!entry.commits.find((x) => x.message === msg)) {
          entry.commits.push({ sha, message: msg, filesChanged: [], additions: 0, deletions: 0 });
        }
      }
    }

    for (const [fullRepo, entry] of repoData) {
      try {
        const listRes = await fetch(
          `https://api.github.com/repos/${fullRepo}/commits?author=${encodeURIComponent(githubUsername)}&since=${since.toISOString()}&until=${now.toISOString()}&per_page=30`,
          { headers: ghHeaders },
        );
        if (!listRes.ok) continue;
        const list = (await listRes.json()) as Array<{ sha: string; commit: { message: string } }>;
        for (const c of list.slice(0, 5)) {
          const msg = c.commit.message.split('\n')[0].trim();
          if (!msg || msg.toLowerCase().startsWith('merge ')) continue;
          try {
            const detailRes = await fetch(
              `https://api.github.com/repos/${fullRepo}/commits/${c.sha}`,
              { headers: ghHeaders },
            );
            if (!detailRes.ok) continue;
            const detail = (await detailRes.json()) as {
              stats?: { additions: number; deletions: number };
              files?: Array<{ filename: string }>;
            };
            const existing = entry.commits.find((x) => x.message === msg);
            const enriched: EnrichedCommit = {
              sha: c.sha.slice(0, 7),
              message: msg,
              filesChanged: (detail.files ?? []).map((f) => f.filename),
              additions: detail.stats?.additions ?? 0,
              deletions: detail.stats?.deletions ?? 0,
            };
            if (existing) {
              Object.assign(existing, enriched);
            } else if (entry.commits.length < 15) {
              entry.commits.push(enriched);
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }

    for (const [key, entry] of repoData) {
      if (entry.commits.length === 0) repoData.delete(key);
    }

    // Fetch attendance for this month
    const monthStart = new Date(reviewYear, reviewMon - 1, 1);
    const monthEnd = new Date(reviewYear, reviewMon, 1);

    const attendanceRows = await this.prisma.studentAttendance.findMany({
      where: {
        studentId: row.studentId,
        instructorId,
        attendedAt: { gte: monthStart, lt: monthEnd },
      },
      orderBy: { attendedAt: 'asc' },
    });

    const attendanceDates = attendanceRows.map((r: any) =>
      (r.attendedAt as Date).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
    );

    const INFRA_FILE_PATTERNS = /^(dockerfile|docker-compose|\.dockerignore|requirements\.txt|pom\.xml|build\.gradle|\.gitignore|\.env|readme\.md|\.github|__pycache__|\.classpath|\.project|\.settings)/i;

    function isLessonFile(filePath: string): boolean {
      return /(?:^|\/)lessons?\//i.test(filePath);
    }
    function lessonNumber(filePath: string): number | null {
      const m = filePath.match(/lessons?\/([\d]+)/i);
      return m ? parseInt(m[1], 10) : null;
    }

    let highestLesson = 0;
    const lessonsSeen = new Set<number>();
    let totalCommits = 0;

    const commitSummary = [...repoData.entries()]
      .slice(0, 3)
      .map(([, { shortName, commits }]) => {
        const commitLines: string[] = [];
        for (const c of commits.slice(0, 8)) {
          totalCommits++;
          const lessonFiles = c.filesChanged.filter(
            (f) => isLessonFile(f) && !INFRA_FILE_PATTERNS.test(f.split('/').pop() ?? f),
          );
          for (const f of lessonFiles) {
            const n = lessonNumber(f);
            if (n !== null) {
              lessonsSeen.add(n);
              if (n > highestLesson) highestLesson = n;
            }
          }
          if (lessonFiles.length === 0) continue;
          const fileSummary = lessonFiles
            .slice(0, 4)
            .map((f) => {
              const parts = f.split('/');
              const lessonIdx = parts.findIndex((p) => /^lessons?$/i.test(p));
              return lessonIdx >= 0
                ? parts.slice(lessonIdx, lessonIdx + 3).join('/')
                : parts.slice(-2).join('/');
            })
            .filter((v, i, a) => a.indexOf(v) === i)
            .join(', ');
          const statPart = c.additions || c.deletions ? ` +${c.additions}/-${c.deletions}` : '';
          commitLines.push(`  - ${c.message} [${fileSummary}]${statPart}`);
        }
        if (commitLines.length === 0) return null;
        return `Repository: ${shortName}\n${commitLines.join('\n')}`;
      })
      .filter(Boolean)
      .join('\n\n');

    if (!commitSummary) {
      throw new ValidationError(
        `No curriculum (lessons/) activity found for @${githubUsername} in the past 30 days. Only infrastructure or non-lesson changes were detected.`,
      );
    }

    const lessonProgressNote =
      highestLesson > 0
        ? `Current curriculum position: reached lesson ${highestLesson}${lessonsSeen.size > 1 ? ` (worked across lessons ${[...lessonsSeen].sort((a, b) => a - b).join(', ')})` : ''}.`
        : '';

    // Dynamic import so that missing groq-sdk at startup doesn't crash
    const { default: Groq } = await import('groq-sdk');
    const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const completion = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 1024,
      messages: [
        {
          role: 'system',
          content: `You are an encouraging coding instructor writing a monthly progress review for a parent/guardian.

Tone rules:
- Warm, positive, and encouraging throughout — frame slow progress as steady, consistent growth
- Highlight the positives first and foremost
- Focus on the highest-numbered (most advanced) lessons the student worked on — these show where they are in the curriculum now
- Only briefly mention lower-numbered lessons if they're directly relevant to understanding the advanced work
- Do NOT make high-achieving students feel they need to do more — keep any suggestions light and optional-sounding
- Base everything ONLY on the commit data and file paths provided; never invent details

Structure (no headers, flowing paragraphs):
1. Progress paragraph — what they worked on, what lesson they've reached, what concepts those lessons cover
2. Effort & highlights paragraph — specific things done well, how the work builds their skills
3. Instructor notes (2–4 sentences only) — one gentle suggestion for the student if helpful, then a brief plan for how the instructor will support them next (e.g. "In our next sessions we'll build on X by introducing Y"). Keep this encouraging, never prescriptive.`,
        },
        {
          role: 'user',
          content: `Write a monthly progress review for ${studentName} (${monthLabel}) to send to their parent/guardian.
${attendanceDates.length > 0 ? `\nClass attendance this month: ${attendanceDates.join(', ')} (${attendanceDates.length} session${attendanceDates.length === 1 ? '' : 's'})` : ''}
${lessonProgressNote ? `\n${lessonProgressNote}` : ''}

Curriculum activity (lessons/ directory, past 30 days):
${commitSummary}

Instructions:
- Open with attendance and their current lesson position
- Lead with the most advanced lesson work, not the earliest
- Keep any improvement suggestion light — one sentence max, framed as "something to explore" not a gap
- End with 2–3 sentences from the instructor on what they'll work on together next
- No greeting, no sign-off, 3 paragraphs`,
        },
      ],
    });

    const llmBody = (completion.choices[0]?.message?.content ?? '').trim();

    const greeting = guardianName ? `Dear ${guardianName},` : 'Dear LEAGUE Family,';

    const attendanceSection =
      attendanceDates.length > 0
        ? `Class sessions attended (${monthLabel}):\n${attendanceDates.map((d: string) => `• ${d}`).join('\n')}`
        : '';

    const repoLinks = [...repoData.entries()]
      .map(
        ([fullRepo, { shortName }]) =>
          `• <a href="https://github.com/${fullRepo}" style="color:#f37121;text-decoration:none;">${shortName}</a> — github.com/${fullRepo}`,
      )
      .join('\n');

    const githubSection = `GitHub activity this past month (last 30 days):\n${repoLinks}`;
    const signOff = `Warm regards,\n${instructorName}\n${instructorEmail}`;

    const parts = [greeting, '', llmBody];
    if (attendanceSection) parts.push('', attendanceSection);
    parts.push('', githubSection, '', signOff);

    return {
      body: parts.join('\n'),
      commitCount: totalCommits,
      repoCount: repoData.size,
    };
  }
}
