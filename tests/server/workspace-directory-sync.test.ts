/**
 * Coverage for the Workspace Filesystem scaffold and sync utility (ticket
 * 002-004): `resolveWorkspacePath`'s path-containment mechanism,
 * `writeDirDescriptor`/`moveDirDescriptor`'s `_dir.json` mirror sync
 * (architecture-001 D6), and the scaffold script's idempotency.
 *
 * All filesystem assertions run against a scratch `WORKSPACE_DIR` (a
 * per-run temp directory) so this suite never touches the real
 * `server/workspace/` tree.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { prisma } from '../../server/src/services/prisma';
import {
  DIR_DESCRIPTOR_FILENAME,
  getWorkspaceRoot,
  resolveWorkspacePath,
  writeDirDescriptor,
  moveDirDescriptor,
} from '../../server/src/services/workspaceDirectorySync';
import {
  scaffoldWorkspaceDirectories,
  TOP_LEVEL_DIRECTORIES,
  CATEGORY_DIRECTORIES,
} from '../../server/src/scripts/scaffold-workspace-directories';

const marker = `t004-${Date.now()}`;

let testRoot: string;
let previousWorkspaceDir: string | undefined;

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'flyerbot-workspace-test-'));
  previousWorkspaceDir = process.env.WORKSPACE_DIR;
  process.env.WORKSPACE_DIR = testRoot;
});

afterAll(async () => {
  if (previousWorkspaceDir === undefined) {
    delete process.env.WORKSPACE_DIR;
  } else {
    process.env.WORKSPACE_DIR = previousWorkspaceDir;
  }
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('getWorkspaceRoot / resolveWorkspacePath', () => {
  it('resolves the configured WORKSPACE_DIR', () => {
    expect(getWorkspaceRoot()).toBe(path.resolve(testRoot));
  });

  it('resolves a relative path under the root', () => {
    expect(resolveWorkspacePath('assets/logos')).toBe(path.join(testRoot, 'assets', 'logos'));
  });

  it('allows the root itself and nested paths within it', () => {
    expect(resolveWorkspacePath('.')).toBe(path.resolve(testRoot));
    expect(() => resolveWorkspacePath('knowledge/styles/deep/nested')).not.toThrow();
  });

  it('rejects ../ traversal escaping the root', () => {
    expect(() => resolveWorkspacePath('../escape')).toThrow(/escapes workspace root/);
    expect(() => resolveWorkspacePath('assets/../../escape')).toThrow(/escapes workspace root/);
  });

  it('rejects an absolute path outside the root', () => {
    expect(() => resolveWorkspacePath('/etc/passwd')).toThrow(/escapes workspace root/);
  });
});

describe('writeDirDescriptor', () => {
  it('writes a _dir.json file whose content matches descriptorJson', async () => {
    const dir = { path: `${marker}/write-test`, descriptorJson: { kind: 'collection', name: 'write-test' } };
    const filePath = await writeDirDescriptor(dir);

    expect(filePath).toBe(path.join(testRoot, marker, 'write-test', DIR_DESCRIPTOR_FILENAME));
    const raw = await fs.readFile(filePath, 'utf8');
    expect(JSON.parse(raw)).toEqual(dir.descriptorJson);
  });

  it('overwrites an existing _dir.json with updated content', async () => {
    const dirPath = `${marker}/overwrite-test`;
    await writeDirDescriptor({ path: dirPath, descriptorJson: { name: 'first' } });
    const filePath = await writeDirDescriptor({ path: dirPath, descriptorJson: { name: 'second' } });

    const raw = await fs.readFile(filePath, 'utf8');
    expect(JSON.parse(raw)).toEqual({ name: 'second' });
  });

  it('defaults to an empty object when descriptorJson is null', async () => {
    const filePath = await writeDirDescriptor({ path: `${marker}/null-descriptor`, descriptorJson: null });
    const raw = await fs.readFile(filePath, 'utf8');
    expect(JSON.parse(raw)).toEqual({});
  });
});

describe('moveDirDescriptor', () => {
  it('relocates the directory and leaves no orphan at the old path', async () => {
    const oldPath = `${marker}/move-src`;
    const newPath = `${marker}/move-dest`;
    await writeDirDescriptor({ path: oldPath, descriptorJson: { name: 'movable' } });

    await moveDirDescriptor(oldPath, newPath);

    await expect(fs.access(resolveWorkspacePath(oldPath))).rejects.toThrow();
    const newFile = path.join(resolveWorkspacePath(newPath), DIR_DESCRIPTOR_FILENAME);
    const raw = await fs.readFile(newFile, 'utf8');
    expect(JSON.parse(raw)).toEqual({ name: 'movable' });
  });

  it('does not throw when nothing exists at the old path yet, and still creates the new directory', async () => {
    const oldPath = `${marker}/never-created`;
    const newPath = `${marker}/move-dest-fresh`;

    await expect(moveDirDescriptor(oldPath, newPath)).resolves.not.toThrow();
    const stat = await fs.stat(resolveWorkspacePath(newPath));
    expect(stat.isDirectory()).toBe(true);
  });
});

describe('scaffoldWorkspaceDirectories', () => {
  const rowIds: number[] = [];

  afterAll(async () => {
    await prisma.workspaceDirectory.deleteMany({ where: { id: { in: rowIds } } });
  });

  it('creates the top-level tree and a WorkspaceDirectory row + _dir.json for each category directory', async () => {
    const result = await scaffoldWorkspaceDirectories(prisma);
    expect(result.created).toBe(CATEGORY_DIRECTORIES.length);
    expect(result.resynced).toBe(0);

    for (const top of TOP_LEVEL_DIRECTORIES) {
      const stat = await fs.stat(resolveWorkspacePath(top));
      expect(stat.isDirectory()).toBe(true);
    }

    for (const category of CATEGORY_DIRECTORIES) {
      const row = await prisma.workspaceDirectory.findUnique({ where: { path: category.relPath } });
      expect(row).not.toBeNull();
      rowIds.push(row!.id);

      const filePath = path.join(resolveWorkspacePath(category.relPath), DIR_DESCRIPTOR_FILENAME);
      const raw = await fs.readFile(filePath, 'utf8');
      expect(JSON.parse(raw)).toEqual(row!.descriptorJson);
    }
  });

  it('is idempotent — a second run creates no duplicate rows and re-syncs mirrors instead', async () => {
    const paths = CATEGORY_DIRECTORIES.map((c) => c.relPath);
    const before = await prisma.workspaceDirectory.count({ where: { path: { in: paths } } });

    const result = await scaffoldWorkspaceDirectories(prisma);

    expect(result.created).toBe(0);
    expect(result.resynced).toBe(CATEGORY_DIRECTORIES.length);

    const after = await prisma.workspaceDirectory.count({ where: { path: { in: paths } } });
    expect(after).toBe(before);
  });
});
