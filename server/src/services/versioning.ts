import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { simpleGit, type SimpleGit } from 'simple-git';
import { prisma as defaultPrisma } from './prisma';
import { getWorkspaceRoot } from './workspaceDirectorySync';

/**
 * Versioning Service (architecture-001 §Module 10, as scoped by this
 * sprint's architecture-update.md R1: "one workspace git repo for now").
 *
 * Commits `workspace/` filesystem changes plus a fresh JSON export
 * snapshot of `KnowledgeEntry`/`Collection` rows to git, batched per agent
 * turn (one commit per turn, not per write) -- never the live `.db` file
 * (D7, unchanged). Invoked by the Workspace MCP Server (tickets 002/003)
 * after a successful filesystem or catalog write; has no dependency on
 * that module itself.
 *
 * Written against two config values so that later splitting `workspace/`
 * into its own repository (architecture-001 Open Question 3) is a config
 * change, not a rewrite:
 *  - `WORKSPACE_GIT_ROOT`: the git working-tree root this service
 *    operates against. Defaults to the app repo root, so `workspace/`
 *    commits land in the same repo/history as the rest of the app
 *    (matching Sprint 002's scaffold).
 *  - `WORKSPACE_GIT_REMOTE`: unset by default -- no push is attempted, no
 *    remote is required to exist. When set, a push is attempted after a
 *    successful commit; a push failure is surfaced as a non-fatal result,
 *    never thrown (architecture-001 UC-012 E1).
 *
 * `AUTO_COMMIT` (read fresh at commit time via `isAutoCommitEnabled()`,
 * same "plain `process.env` read" pattern as `PORT`/`WORKSPACE_DIR`) gates
 * only the `git commit` (and any subsequent push) inside `commitTurn`.
 * When explicitly disabled (`'false'`, `'0'`, `'off'`, `'no'`,
 * case-insensitive), `commitTurn` still runs the knowledge snapshot
 * export and stages recorded changes, but skips `git commit`/`git push`
 * and returns `{ committed: false, pushed: false }` -- the same
 * "nothing to commit" shape callers already handle. Unset or any other
 * value (`'true'`, `'1'`, etc.) preserves the pre-existing behavior.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// server/src/services -> server/src -> server -> app repo root.
const DEFAULT_APP_REPO_ROOT = path.resolve(__dirname, '../../..');

/** Filename (case-insensitive) suffixes never staged, even if a caller
 * mistakenly hands one to `recordChange` -- the live SQLite DB and its
 * WAL/journal sidecar files must never enter git (D7). */
const FORBIDDEN_SUFFIXES = ['.db', '.db-journal', '.db-wal', '.db-shm'];

/** The git working-tree root this service operates against. Computed
 * fresh on every call (not cached at module load) so tests can point
 * `WORKSPACE_GIT_ROOT` at a scratch directory per run. */
export function getWorkspaceGitRoot(): string {
  return path.resolve(process.env.WORKSPACE_GIT_ROOT || DEFAULT_APP_REPO_ROOT);
}

/** The git remote (a registered remote name, a filesystem path, or a URL)
 * to push to after a commit, or `undefined` when unset (local-commit-only,
 * this sprint's default -- see R1). */
export function getWorkspaceGitRemote(): string | undefined {
  return process.env.WORKSPACE_GIT_REMOTE || undefined;
}

/** Falsy values (case-insensitive) that turn automatic git commits off. */
const AUTO_COMMIT_OFF_VALUES = new Set(['false', '0', 'off', 'no']);

/** Whether `commitTurn` should perform the automatic `git commit` (and any
 * subsequent push). Read fresh on every call (not cached) so a restart --
 * or, in tests, a per-test env override -- picks up the current value.
 * Unset defaults to `true` (backward compatible: nothing changes for
 * anyone who hasn't set `AUTO_COMMIT`). */
export function isAutoCommitEnabled(): boolean {
  const raw = process.env.AUTO_COMMIT;
  if (raw === undefined) return true;
  return !AUTO_COMMIT_OFF_VALUES.has(raw.trim().toLowerCase());
}

function isForbiddenPath(absolutePath: string): boolean {
  const lower = absolutePath.toLowerCase();
  return FORBIDDEN_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

export interface CommitResult {
  /** Whether a commit was created. `false` when there was nothing staged
   * (e.g. no recorded changes and snapshot export produced no diff). */
  committed: boolean;
  /** The new commit's hash, when `committed` is true. */
  commitHash?: string;
  /** Whether the commit was successfully pushed to `WORKSPACE_GIT_REMOTE`.
   * Always `false` when no remote is configured. */
  pushed: boolean;
  /** The push failure message, when a remote was configured but the push
   * failed. The local commit still stands -- this is a non-fatal result,
   * never a thrown exception (architecture-001 UC-012 E1). */
  pushError?: string;
}

export interface VersioningServiceOptions {
  /** Overrides `WORKSPACE_GIT_ROOT` / its default for this instance. */
  gitRoot?: string;
  /** Overrides `WORKSPACE_GIT_REMOTE` / its default for this instance. */
  remote?: string;
  /** Prisma client used by `exportKnowledgeSnapshot`; defaults to the
   * shared app singleton. Test-injectable. */
  prismaClient?: any;
  /** Absolute directory `exportKnowledgeSnapshot` writes into; defaults to
   * `<workspace root>/exports`. Test-injectable so scratch-repo tests don't
   * need a real `WORKSPACE_DIR`/workspace tree. */
  exportsDir?: string;
}

/**
 * Stages and commits changed `workspace/` paths, batched per agent turn:
 * call `recordChange` for each write made during the turn, then one
 * `commitTurn` call produces exactly one git commit covering all of them
 * plus a fresh knowledge-store export snapshot.
 */
export class WorkspaceVersioningService {
  private readonly git: SimpleGit;
  private readonly gitRoot: string;
  private readonly remote: string | undefined;
  private readonly prisma: any;
  private readonly exportsDir: string;
  private readonly pending = new Set<string>();

  constructor(options: VersioningServiceOptions = {}) {
    this.gitRoot = path.resolve(options.gitRoot ?? getWorkspaceGitRoot());
    this.remote = options.remote ?? getWorkspaceGitRemote();
    this.prisma = options.prismaClient ?? defaultPrisma;
    this.exportsDir = options.exportsDir
      ? path.resolve(options.exportsDir)
      : path.join(getWorkspaceRoot(), 'exports');
    this.git = simpleGit(this.gitRoot);
  }

  /**
   * Record a changed path for inclusion in the next `commitTurn` call.
   * Accepts an absolute filesystem path (or one resolved via
   * `resolveWorkspacePath`); must resolve within `WORKSPACE_GIT_ROOT`.
   * A live `.db`/WAL/journal path is silently dropped, never queued --
   * the caller may pass one in error, but it must never reach git (D7).
   */
  recordChange(absoluteOrRelativePath: string): void {
    const resolved = path.resolve(this.gitRoot, absoluteOrRelativePath);
    const rel = path.relative(this.gitRoot, resolved);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new Error(`Path escapes WORKSPACE_GIT_ROOT: ${absoluteOrRelativePath}`);
    }
    if (isForbiddenPath(resolved)) {
      // eslint-disable-next-line no-console
      console.warn(`[versioning] refusing to record live database path: ${resolved}`);
      return;
    }
    this.pending.add(resolved);
  }

  /**
   * Write a fresh JSON snapshot of all `KnowledgeEntry`/`Collection` rows
   * to `workspace/exports/knowledge-snapshot.json` (fixed-rolling
   * filename -- each turn overwrites it, so the commit history carries
   * the versions, not the filesystem). Returns the absolute path written.
   */
  async exportKnowledgeSnapshot(): Promise<string> {
    await fs.mkdir(this.exportsDir, { recursive: true });

    const [knowledgeEntries, collections] = await Promise.all([
      this.prisma.knowledgeEntry.findMany(),
      this.prisma.collection.findMany(),
    ]);

    const snapshot = {
      exportedAt: new Date().toISOString(),
      knowledgeEntries,
      collections,
    };

    const filePath = path.join(this.exportsDir, 'knowledge-snapshot.json');
    await fs.writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    return filePath;
  }

  /**
   * Stage every path recorded via `recordChange` since the last
   * `commitTurn` (plus a fresh knowledge snapshot, unless
   * `skipSnapshot` is set) and create exactly one git commit. When
   * `WORKSPACE_GIT_REMOTE` is configured, attempts a push after a
   * successful commit; a push failure is caught and returned as
   * `pushed: false` plus a logged warning, never thrown.
   *
   * Returns `{ committed: false, pushed: false }` when there is nothing
   * to commit (no recorded changes and the snapshot produced no diff),
   * OR when `AUTO_COMMIT` is disabled (`isAutoCommitEnabled()` false) --
   * in that case the snapshot export and `recordChange`-tracked file
   * writes still happen as normal; only the `git commit` (and any
   * subsequent push) is skipped.
   */
  async commitTurn(summary: string, options: { skipSnapshot?: boolean } = {}): Promise<CommitResult> {
    if (!options.skipSnapshot) {
      const snapshotPath = await this.exportKnowledgeSnapshot();
      this.recordChange(snapshotPath);
    }

    const paths = Array.from(this.pending);
    this.pending.clear();

    if (paths.length === 0) {
      return { committed: false, pushed: false };
    }

    if (!isAutoCommitEnabled()) {
      // AUTO_COMMIT is off: workspace writes and the snapshot export above
      // already happened, but the automatic git commit (and any push) is
      // skipped entirely -- not even `git add` runs.
      return { committed: false, pushed: false };
    }

    const relPaths = paths.map((p) => path.relative(this.gitRoot, p));
    await this.git.add(relPaths);

    const status = await this.git.status();
    if (status.staged.length === 0) {
      // Nothing actually changed content-wise (e.g. re-export produced an
      // identical snapshot) -- no-op, not an empty commit.
      return { committed: false, pushed: false };
    }

    const commitSummary = await this.git.commit(summary);
    const commitHash = commitSummary.commit || undefined;

    let pushed = false;
    let pushError: string | undefined;
    if (this.remote) {
      try {
        await this.git.push(this.remote, 'HEAD');
        pushed = true;
      } catch (err: any) {
        pushError = err?.message ?? String(err);
        // eslint-disable-next-line no-console
        console.warn(`[versioning] push to WORKSPACE_GIT_REMOTE (${this.remote}) failed:`, pushError);
      }
    }

    return { committed: true, commitHash, pushed, pushError };
  }
}

/** Default app singleton, configured from `WORKSPACE_GIT_ROOT` /
 * `WORKSPACE_GIT_REMOTE`. Consumers needing a scratch/test instance should
 * construct their own `WorkspaceVersioningService` with explicit options
 * instead of using this singleton. */
export const versioningService = new WorkspaceVersioningService();
