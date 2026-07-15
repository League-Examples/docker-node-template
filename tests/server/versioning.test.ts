/**
 * Coverage for the Versioning Service (ticket 003-001): batched git
 * commit of `workspace/` changes plus a knowledge-store export snapshot,
 * config-gated push (architecture-001 §Module 10, this sprint's
 * architecture-update.md R1 one-repo default).
 *
 * SAFETY: every test here operates against a scratch git repo created
 * fresh under a per-run temp directory (`WorkspaceVersioningService`'s
 * `gitRoot` option) -- never the real app repo's git state. No test in
 * this file may omit an explicit `gitRoot`/`exportsDir` pointing at a
 * temp directory.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { simpleGit } from 'simple-git';
import {
  WorkspaceVersioningService,
  getWorkspaceGitRoot,
  getWorkspaceGitRemote,
} from '../../server/src/services/versioning';

async function mkScratchRepo(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'versioning-test@example.com');
  await git.addConfig('user.name', 'Versioning Test');
  return dir;
}

async function writeFile(root: string, relPath: string, content: string): Promise<string> {
  const filePath = path.join(root, relPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
}

const scratchDirs: string[] = [];

async function newScratchRepo(prefix: string): Promise<string> {
  const dir = await mkScratchRepo(prefix);
  scratchDirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(scratchDirs.map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe('getWorkspaceGitRoot / getWorkspaceGitRemote (config reads, no git commands)', () => {
  const previousRoot = process.env.WORKSPACE_GIT_ROOT;
  const previousRemote = process.env.WORKSPACE_GIT_REMOTE;

  afterEach(() => {
    if (previousRoot === undefined) delete process.env.WORKSPACE_GIT_ROOT;
    else process.env.WORKSPACE_GIT_ROOT = previousRoot;
    if (previousRemote === undefined) delete process.env.WORKSPACE_GIT_REMOTE;
    else process.env.WORKSPACE_GIT_REMOTE = previousRemote;
  });

  it('defaults WORKSPACE_GIT_ROOT to the app repo root when unset', () => {
    delete process.env.WORKSPACE_GIT_ROOT;
    // server/src/services -> server/src -> server -> repo root
    const expected = path.resolve(__dirname, '..', '..');
    expect(getWorkspaceGitRoot()).toBe(expected);
  });

  it('respects an explicit WORKSPACE_GIT_ROOT override', () => {
    process.env.WORKSPACE_GIT_ROOT = '/tmp/some-scratch-root';
    expect(getWorkspaceGitRoot()).toBe(path.resolve('/tmp/some-scratch-root'));
  });

  it('defaults WORKSPACE_GIT_REMOTE to unset (no push)', () => {
    delete process.env.WORKSPACE_GIT_REMOTE;
    expect(getWorkspaceGitRemote()).toBeUndefined();
  });

  it('respects an explicit WORKSPACE_GIT_REMOTE override', () => {
    process.env.WORKSPACE_GIT_REMOTE = '/tmp/some-bare-repo.git';
    expect(getWorkspaceGitRemote()).toBe('/tmp/some-bare-repo.git');
  });
});

describe('WorkspaceVersioningService.commitTurn — batching', () => {
  it('two writes recorded before one commitTurn call produce exactly one git commit', async () => {
    const gitRoot = await newScratchRepo('flyerbot-versioning-batch-');
    const svc = new WorkspaceVersioningService({ gitRoot, exportsDir: path.join(gitRoot, 'workspace', 'exports') });

    const file1 = await writeFile(gitRoot, 'workspace/assets/logos/one.txt', 'first change\n');
    const file2 = await writeFile(gitRoot, 'workspace/knowledge/styles/two.txt', 'second change\n');
    svc.recordChange(file1);
    svc.recordChange(file2);

    const result = await svc.commitTurn('turn: two writes', { skipSnapshot: true });

    expect(result.committed).toBe(true);
    expect(result.commitHash).toBeTruthy();
    expect(result.pushed).toBe(false);

    const git = simpleGit(gitRoot);
    const log = await git.log();
    expect(log.all).toHaveLength(1);

    const committedFiles = await git.raw(['ls-tree', '-r', '--name-only', 'HEAD']);
    expect(committedFiles).toContain('workspace/assets/logos/one.txt');
    expect(committedFiles).toContain('workspace/knowledge/styles/two.txt');
  });

  it('returns committed: false and creates no commit when nothing was recorded', async () => {
    const gitRoot = await newScratchRepo('flyerbot-versioning-empty-');
    const svc = new WorkspaceVersioningService({ gitRoot, exportsDir: path.join(gitRoot, 'workspace', 'exports') });

    const result = await svc.commitTurn('turn: nothing changed', { skipSnapshot: true });

    expect(result.committed).toBe(false);
    expect(result.pushed).toBe(false);
    expect(result.commitHash).toBeUndefined();

    const git = simpleGit(gitRoot);
    const log = await git.log().catch(() => null);
    // A fresh repo with no commits either throws on `log()` or returns an
    // empty list, depending on git version -- either way, no commit exists.
    if (log) expect(log.all).toHaveLength(0);
  });

  it('a second commitTurn call after a second batch of writes produces a second, separate commit', async () => {
    const gitRoot = await newScratchRepo('flyerbot-versioning-two-turns-');
    const svc = new WorkspaceVersioningService({ gitRoot, exportsDir: path.join(gitRoot, 'workspace', 'exports') });

    const fileA = await writeFile(gitRoot, 'workspace/assets/a.txt', 'a\n');
    svc.recordChange(fileA);
    await svc.commitTurn('turn 1', { skipSnapshot: true });

    const fileB = await writeFile(gitRoot, 'workspace/assets/b.txt', 'b\n');
    svc.recordChange(fileB);
    const result2 = await svc.commitTurn('turn 2', { skipSnapshot: true });

    expect(result2.committed).toBe(true);

    const git = simpleGit(gitRoot);
    const log = await git.log();
    expect(log.all).toHaveLength(2);
  });
});

describe('WorkspaceVersioningService — live DB file is never staged', () => {
  it('drops a recorded .db path silently and commits the rest', async () => {
    const gitRoot = await newScratchRepo('flyerbot-versioning-dbfile-');
    const svc = new WorkspaceVersioningService({ gitRoot, exportsDir: path.join(gitRoot, 'workspace', 'exports') });

    const realFile = await writeFile(gitRoot, 'workspace/assets/keep.txt', 'keep me\n');
    const dbFile = await writeFile(gitRoot, 'workspace/data/dev.db', 'not really sqlite, just a stand-in\n');
    const walFile = await writeFile(gitRoot, 'workspace/data/dev.db-wal', 'wal stand-in\n');

    svc.recordChange(realFile);
    svc.recordChange(dbFile);
    svc.recordChange(walFile);

    const result = await svc.commitTurn('turn: attempted db write', { skipSnapshot: true });

    expect(result.committed).toBe(true);

    const git = simpleGit(gitRoot);
    const committedFiles = await git.raw(['ls-tree', '-r', '--name-only', 'HEAD']);
    expect(committedFiles).toContain('workspace/assets/keep.txt');
    expect(committedFiles).not.toContain('workspace/data/dev.db');
    expect(committedFiles).not.toContain('workspace/data/dev.db-wal');

    // The .db file is correctly left untracked (never staged, never
    // committed) -- it shows up as "not added" precisely because the
    // service refused to stage it.
    const status = await git.status();
    expect(status.not_added).toContain('workspace/data/dev.db');
    expect(status.staged).not.toContain('workspace/data/dev.db');
  });
});

describe('WorkspaceVersioningService.exportKnowledgeSnapshot', () => {
  it('writes a JSON snapshot file and includes it in the same commit as recorded changes', async () => {
    const gitRoot = await newScratchRepo('flyerbot-versioning-snapshot-');
    const exportsDir = path.join(gitRoot, 'workspace', 'exports');
    const svc = new WorkspaceVersioningService({ gitRoot, exportsDir });

    const changedFile = await writeFile(gitRoot, 'workspace/assets/thing.txt', 'thing\n');
    svc.recordChange(changedFile);

    const result = await svc.commitTurn('turn: with snapshot');

    expect(result.committed).toBe(true);

    const snapshotPath = path.join(exportsDir, 'knowledge-snapshot.json');
    const raw = await fs.readFile(snapshotPath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveProperty('exportedAt');
    expect(parsed).toHaveProperty('knowledgeEntries');
    expect(parsed).toHaveProperty('collections');
    expect(Array.isArray(parsed.knowledgeEntries)).toBe(true);
    expect(Array.isArray(parsed.collections)).toBe(true);

    const git = simpleGit(gitRoot);
    const committedFiles = await git.raw(['ls-tree', '-r', '--name-only', 'HEAD']);
    expect(committedFiles).toContain('workspace/assets/thing.txt');
    expect(committedFiles).toContain('workspace/exports/knowledge-snapshot.json');

    const log = await git.log();
    expect(log.all).toHaveLength(1);
  });
});

describe('WorkspaceVersioningService — config-gated push', () => {
  it('does not attempt a push when no remote is configured', async () => {
    const gitRoot = await newScratchRepo('flyerbot-versioning-nopush-');
    const svc = new WorkspaceVersioningService({ gitRoot, exportsDir: path.join(gitRoot, 'workspace', 'exports') });

    const file = await writeFile(gitRoot, 'workspace/assets/nopush.txt', 'no push\n');
    svc.recordChange(file);

    const result = await svc.commitTurn('turn: no remote', { skipSnapshot: true });

    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(false);
    expect(result.pushError).toBeUndefined();
  });

  it('pushes to a configured throwaway local bare remote after a successful commit', async () => {
    const gitRoot = await newScratchRepo('flyerbot-versioning-push-');
    const bareRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'flyerbot-versioning-bare-'));
    scratchDirs.push(bareRepo);
    await simpleGit(bareRepo).init(true); // git init --bare

    const svc = new WorkspaceVersioningService({
      gitRoot,
      remote: bareRepo,
      exportsDir: path.join(gitRoot, 'workspace', 'exports'),
    });

    const file = await writeFile(gitRoot, 'workspace/assets/pushed.txt', 'pushed\n');
    svc.recordChange(file);

    const result = await svc.commitTurn('turn: with remote', { skipSnapshot: true });

    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(true);
    expect(result.pushError).toBeUndefined();

    const bareGit = simpleGit(bareRepo);
    const bareLog = await bareGit.log();
    expect(bareLog.all).toHaveLength(1);
    expect(bareLog.latest?.hash).toBe(result.commitHash);
  });

  it('a push failure to an invalid/unreachable remote does not throw and the local commit still stands', async () => {
    const gitRoot = await newScratchRepo('flyerbot-versioning-badpush-');
    const invalidRemote = path.join(os.tmpdir(), `flyerbot-nonexistent-remote-${Date.now()}`, 'repo.git');

    const svc = new WorkspaceVersioningService({
      gitRoot,
      remote: invalidRemote,
      exportsDir: path.join(gitRoot, 'workspace', 'exports'),
    });

    const file = await writeFile(gitRoot, 'workspace/assets/badpush.txt', 'bad push\n');
    svc.recordChange(file);

    let result;
    await expect((async () => {
      result = await svc.commitTurn('turn: bad remote', { skipSnapshot: true });
    })()).resolves.not.toThrow();

    expect(result!.committed).toBe(true);
    expect(result!.pushed).toBe(false);
    expect(result!.pushError).toBeTruthy();

    const git = simpleGit(gitRoot);
    const log = await git.log();
    expect(log.all).toHaveLength(1);
  });
});

describe('WorkspaceVersioningService.recordChange — path containment', () => {
  it('throws when a recorded path escapes gitRoot', async () => {
    const gitRoot = await newScratchRepo('flyerbot-versioning-escape-');
    const svc = new WorkspaceVersioningService({ gitRoot, exportsDir: path.join(gitRoot, 'workspace', 'exports') });

    const outside = path.join(os.tmpdir(), 'definitely-outside-repo.txt');
    expect(() => svc.recordChange(outside)).toThrow(/escapes WORKSPACE_GIT_ROOT/);
  });
});
