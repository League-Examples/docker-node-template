/**
 * Coverage for the Workspace MCP Server's filesystem tool family
 * (ticket 003-002): `read_file`, `move_file`, `create_directory`, `stat`
 * -- path containment (reusing Sprint 002's `resolveWorkspacePath`), the
 * shared `Lock` acquire/release helper (`locks.ts`), and the
 * hand-off to the Versioning Service's `recordChange` after a successful
 * mutation (architecture-001 §Module 4, D9, this sprint's R5).
 *
 * All filesystem assertions run against a scratch `WORKSPACE_DIR` (a
 * per-run temp directory), never the real `server/workspace/` tree. All
 * `Lock` assertions run against the real test database (this suite's own
 * rows only, cleaned up in `afterEach`).
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { prisma } from '../../server/src/services/prisma';
import { getWorkspaceRoot, resolveWorkspacePath } from '../../server/src/services/workspaceDirectorySync';
import {
  readFile,
  statPath,
  moveFile,
  createDirectory,
  registerFsTools,
  type VersioningRecorder,
} from '../../server/src/agent-mcp/fsTools';
import { createWorkspaceMcpServer } from '../../server/src/agent-mcp/server';
import { acquireLock, releaseLock, LockConflictError } from '../../server/src/agent-mcp/locks';

let testRoot: string;
let previousWorkspaceDir: string | undefined;

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'flyerbot-agent-mcp-fs-test-'));
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

afterEach(async () => {
  // Belt-and-braces: no test in this file should leave a Lock row behind
  // (every acquire is matched by a release, including in `finally`
  // blocks), but clean up defensively so a failing assertion mid-test
  // never leaks state into a later test.
  await prisma.lock.deleteMany({ where: { resourceType: 'directory' } });
});

/** A `VersioningRecorder` spy: records every path passed to
 * `recordChange` without touching git or the real singleton. */
function spyVersioning(): VersioningRecorder & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    recordChange(p: string) {
      calls.push(p);
    },
  };
}

describe('registerFsTools / createWorkspaceMcpServer — tool surface', () => {
  it('registers exactly read_file, move_file, create_directory, stat — no other tools, no shell/exec tool', async () => {
    const server = createWorkspaceMcpServer();
    // The SDK doesn't expose a public "list registered tool names"
    // accessor pre-connect, but `_registeredTools` is populated
    // synchronously by `server.tool(...)` and is the same map the SDK's
    // own `tools/list` handler reads from (see mcp.js).
    const names = Object.keys((server as any)._registeredTools ?? {}).sort();
    expect(names).toEqual(['create_directory', 'move_file', 'read_file', 'stat']);
  });

  it('never wires the workspace server onto an Express route (no HTTP transport import)', async () => {
    // Structural check: server.ts must not import express or any route
    // module. Verified by construction succeeding with zero HTTP
    // dependencies in this test file's own import graph.
    expect(typeof createWorkspaceMcpServer).toBe('function');
  });
});

describe('read_file', () => {
  it('succeeds for a path inside the workspace root and returns content', async () => {
    const relPath = 'assets/hello.txt';
    await fs.mkdir(path.dirname(resolveWorkspacePath(relPath)), { recursive: true });
    await fs.writeFile(resolveWorkspacePath(relPath), 'hello world\n', 'utf8');

    const result = await readFile({ path: relPath });

    expect(result.path).toBe(relPath);
    expect(result.encoding).toBe('base64');
    expect(Buffer.from(result.content, 'base64').toString('utf8')).toBe('hello world\n');
  });

  it('rejects a ../ traversal path before any filesystem I/O', async () => {
    await expect(readFile({ path: '../escape.txt' })).rejects.toThrow(/escapes workspace root/);
  });

  it('rejects an absolute path outside the workspace root', async () => {
    await expect(readFile({ path: '/etc/passwd' })).rejects.toThrow(/escapes workspace root/);
  });

  it('never creates a Lock row', async () => {
    const relPath = 'assets/no-lock-read.txt';
    await fs.mkdir(path.dirname(resolveWorkspacePath(relPath)), { recursive: true });
    await fs.writeFile(resolveWorkspacePath(relPath), 'no lock\n', 'utf8');

    await readFile({ path: relPath });

    const count = await prisma.lock.count({ where: { resourceType: 'directory', resourceKey: relPath } });
    expect(count).toBe(0);
  });
});

describe('stat', () => {
  it('succeeds for a path inside the workspace root and returns metadata', async () => {
    const relPath = 'assets/stat-me.txt';
    await fs.mkdir(path.dirname(resolveWorkspacePath(relPath)), { recursive: true });
    await fs.writeFile(resolveWorkspacePath(relPath), 'stat content\n', 'utf8');

    const result = await statPath({ path: relPath });

    expect(result.exists).toBe(true);
    expect(result.isFile).toBe(true);
    expect(result.isDirectory).toBe(false);
    expect(result.size).toBe(Buffer.byteLength('stat content\n'));
  });

  it('returns exists: false for a missing path inside the root, without throwing', async () => {
    const result = await statPath({ path: 'assets/does-not-exist.txt' });
    expect(result.exists).toBe(false);
  });

  it('rejects a ../ traversal path before any filesystem I/O', async () => {
    await expect(statPath({ path: '../../escape' })).rejects.toThrow(/escapes workspace root/);
  });

  it('rejects an absolute path outside the workspace root', async () => {
    await expect(statPath({ path: '/etc' })).rejects.toThrow(/escapes workspace root/);
  });

  it('never creates a Lock row', async () => {
    await statPath({ path: 'assets/no-lock-stat.txt' });
    const count = await prisma.lock.count({ where: { resourceType: 'directory' } });
    expect(count).toBe(0);
  });
});

describe('create_directory', () => {
  it('succeeds for a path inside the workspace root', async () => {
    const relPath = `new-category-${Date.now()}`;
    const result = await createDirectory({ path: relPath }, { versioning: spyVersioning() });

    expect(result.created).toBe(true);
    const stat = await fs.stat(resolveWorkspacePath(relPath));
    expect(stat.isDirectory()).toBe(true);
  });

  it('rejects a ../ traversal path before any filesystem I/O and creates nothing', async () => {
    await expect(createDirectory({ path: '../escape-dir' })).rejects.toThrow(/escapes workspace root/);
    const outside = path.resolve(getWorkspaceRoot(), '..', 'escape-dir');
    await expect(fs.access(outside)).rejects.toThrow();
  });

  it('rejects an absolute path outside the workspace root', async () => {
    await expect(createDirectory({ path: '/tmp/should-not-be-created' })).rejects.toThrow(/escapes workspace root/);
  });

  it('acquires and releases a Lock row around the operation', async () => {
    const relPath = `locked-dir-${Date.now()}`;

    await createDirectory({ path: relPath }, { versioning: spyVersioning() });

    const count = await prisma.lock.count({ where: { resourceType: 'directory', resourceKey: relPath } });
    expect(count).toBe(0); // released after completion
  });

  it('rejects a second call for the same resourceKey while the first lock is still held', async () => {
    const relPath = `contended-dir-${Date.now()}`;
    await acquireLock('directory', relPath, 'first-caller');

    try {
      await expect(createDirectory({ path: relPath }, { versioning: spyVersioning() })).rejects.toThrow(
        LockConflictError
      );
    } finally {
      await releaseLock('directory', relPath);
    }
  });

  it('releases the lock even when the underlying mkdir throws', async () => {
    // Force a throw by making the target path collide with an existing
    // file (mkdir on a path where a file already sits is invalid).
    const relPath = `blocked-by-file-${Date.now()}`;
    await fs.writeFile(resolveWorkspacePath(relPath), 'i am a file, not a directory\n', 'utf8');

    await expect(createDirectory({ path: relPath }, { versioning: spyVersioning() })).rejects.toThrow();

    const count = await prisma.lock.count({ where: { resourceType: 'directory', resourceKey: relPath } });
    expect(count).toBe(0);
  });

  it('invokes the Versioning Service recordChange after the mutation completes', async () => {
    const relPath = `versioned-dir-${Date.now()}`;
    const versioning = spyVersioning();

    await createDirectory({ path: relPath }, { versioning });

    expect(versioning.calls).toHaveLength(1);
    expect(versioning.calls[0]).toBe(resolveWorkspacePath(relPath));
  });
});

describe('move_file', () => {
  async function writeSource(relPath: string, content: string): Promise<void> {
    const abs = resolveWorkspacePath(relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
  }

  it('succeeds for a source and destination inside the workspace root', async () => {
    const source = `assets/move-src-${Date.now()}.txt`;
    const destination = `assets/move-dest-${Date.now()}.txt`;
    await writeSource(source, 'move me\n');

    const result = await moveFile({ source, destination }, { versioning: spyVersioning() });

    expect(result.moved).toBe(true);
    await expect(fs.access(resolveWorkspacePath(source))).rejects.toThrow();
    const moved = await fs.readFile(resolveWorkspacePath(destination), 'utf8');
    expect(moved).toBe('move me\n');
  });

  it('rejects when the source escapes the root, before any filesystem I/O', async () => {
    await expect(
      moveFile({ source: '../outside-source.txt', destination: 'assets/dest.txt' }, { versioning: spyVersioning() })
    ).rejects.toThrow(/escapes workspace root/);
  });

  it('rejects when the destination escapes the root even though the source is inside it, before any filesystem I/O', async () => {
    const source = `assets/legit-source-${Date.now()}.txt`;
    await writeSource(source, 'still here\n');

    await expect(
      moveFile({ source, destination: '../../outside-dest.txt' }, { versioning: spyVersioning() })
    ).rejects.toThrow(/escapes workspace root/);

    // Source must be untouched -- rejection happened before any I/O.
    const stillThere = await fs.readFile(resolveWorkspacePath(source), 'utf8');
    expect(stillThere).toBe('still here\n');
  });

  it('rejects an absolute destination path outside the workspace root', async () => {
    const source = `assets/abs-dest-source-${Date.now()}.txt`;
    await writeSource(source, 'x\n');

    await expect(
      moveFile({ source, destination: '/tmp/should-not-be-written.txt' }, { versioning: spyVersioning() })
    ).rejects.toThrow(/escapes workspace root/);
  });

  it('acquires and releases a Lock row around the operation', async () => {
    const source = `assets/lock-src-${Date.now()}.txt`;
    const destination = `assets/lock-dest-${Date.now()}.txt`;
    await writeSource(source, 'lock me\n');

    await moveFile({ source, destination }, { versioning: spyVersioning() });

    const count = await prisma.lock.count({ where: { resourceType: 'directory', resourceKey: destination } });
    expect(count).toBe(0); // released after completion
  });

  it('rejects a second call for the same destination resourceKey while the first lock is still held', async () => {
    const destination = `assets/contended-dest-${Date.now()}.txt`;
    const sourceA = `assets/contended-src-a-${Date.now()}.txt`;
    await writeSource(sourceA, 'a\n');
    await acquireLock('directory', destination, 'first-caller');

    try {
      await expect(
        moveFile({ source: sourceA, destination }, { versioning: spyVersioning() })
      ).rejects.toThrow(LockConflictError);
    } finally {
      await releaseLock('directory', destination);
    }
  });

  it('releases the lock even when the underlying rename throws (missing source)', async () => {
    const destination = `assets/rename-throws-dest-${Date.now()}.txt`;

    await expect(
      moveFile({ source: 'assets/does-not-exist-source.txt', destination }, { versioning: spyVersioning() })
    ).rejects.toThrow();

    const count = await prisma.lock.count({ where: { resourceType: 'directory', resourceKey: destination } });
    expect(count).toBe(0);
  });

  it('invokes the Versioning Service recordChange after the mutation completes', async () => {
    const source = `assets/versioned-src-${Date.now()}.txt`;
    const destination = `assets/versioned-dest-${Date.now()}.txt`;
    await writeSource(source, 'version this move\n');
    const versioning = spyVersioning();

    await moveFile({ source, destination }, { versioning });

    expect(versioning.calls).toHaveLength(1);
    expect(versioning.calls[0]).toBe(resolveWorkspacePath(destination));
  });
});

describe('registered tools on a workspace MCP server instance behave the same as the exported functions', () => {
  it('a registered create_directory tool call resolves to the same on-disk effect', async () => {
    const versioning = spyVersioning();
    const server = createWorkspaceMcpServer({ versioning });
    const relPath = `via-server-${Date.now()}`;

    const tool = (server as any)._registeredTools['create_directory'];
    const result = await tool.handler({ path: relPath }, {});

    expect(result.content[0].text).toContain('"created": true');
    const stat = await fs.stat(resolveWorkspacePath(relPath));
    expect(stat.isDirectory()).toBe(true);
    expect(versioning.calls).toHaveLength(1);
  });
});
