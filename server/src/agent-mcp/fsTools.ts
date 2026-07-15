import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getWorkspaceRoot, resolveWorkspacePath } from '../services/workspaceDirectorySync';
import { versioningService as defaultVersioningService } from '../services/versioning';
import { acquireLock, releaseLock } from './locks';

/**
 * Filesystem tool family for the Workspace MCP Server (architecture-001
 * §Module 4, this sprint's ticket 002): `read_file`, `move_file`,
 * `create_directory`, `stat` -- and no others. There is no generic
 * shell/exec tool here or anywhere else the Agent Runtime can reach
 * (Security Considerations, "No shell, ever").
 *
 * Every tool resolves its path argument(s) through Sprint 002's
 * `resolveWorkspacePath` (never reimplemented here) before doing any I/O,
 * so a `../` traversal, an absolute path outside the root, or (for
 * `move_file`) a destination that escapes the root even though the
 * source is inside it, is rejected before any filesystem access occurs.
 *
 * Reads (`read_file`, `stat`) are unmoderated per D9 -- no lock is taken.
 * Mutations (`move_file`, `create_directory`) acquire a `Lock` row
 * (`resourceType: 'directory'`, `resourceKey`: the resolved
 * workspace-relative path being written) before executing and release it
 * in a `finally` block, so a concurrent conflicting acquisition is
 * rejected immediately (`LockConflictError`, see `./locks.ts`) rather
 * than queued, and the lock is never left dangling after a mid-operation
 * throw. A successful mutation calls the Versioning Service's
 * `recordChange` (ticket 001) only *after* the filesystem mutation has
 * completed -- `commitTurn`, which actually produces the git commit, is
 * the Agent Runtime's job (ticket 005), not this module's.
 */

function textResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

/** Convert an absolute, already-`resolveWorkspacePath`-validated path
 * into a path relative to the workspace root, for use as a `Lock`
 * `resourceKey` and in tool responses. `'.'` for the root itself. */
function toWorkspaceRelative(absolutePath: string): string {
  const rel = path.relative(getWorkspaceRoot(), absolutePath);
  return rel === '' ? '.' : rel;
}

/** Minimal shape of the Versioning Service this module depends on --
 * satisfied by `WorkspaceVersioningService`, and narrow enough that
 * tests can inject a spy/mock instead of the real git-backed singleton. */
export interface VersioningRecorder {
  recordChange(absoluteOrRelativePath: string): void;
}

export interface FsToolsOptions {
  /** Versioning Service instance to call `recordChange` on after a
   * successful mutation. Defaults to the shared app singleton
   * (`server/src/services/versioning.ts`); test-injectable. */
  versioning?: VersioningRecorder;
  /** Free-text `Lock.holder` value recorded on acquired locks (e.g. a
   * turn or tool-call id), for diagnostics only. */
  lockHolder?: string;
}

export interface ReadFileResult {
  path: string;
  encoding: 'base64';
  content: string;
  size: number;
}

/** `read_file` -- resolves `args.path` against the workspace root and
 * returns its content. No lock is acquired (reads are unmoderated, D9).
 * Content is base64-encoded so both text and binary (e.g. image) assets
 * under `workspace/` round-trip losslessly through a single tool shape. */
export async function readFile(args: { path: string }): Promise<ReadFileResult> {
  const resolved = resolveWorkspacePath(args.path);
  const buffer = await fs.readFile(resolved);
  return {
    path: toWorkspaceRelative(resolved),
    encoding: 'base64',
    content: buffer.toString('base64'),
    size: buffer.length,
  };
}

export interface StatResult {
  path: string;
  exists: boolean;
  isFile?: boolean;
  isDirectory?: boolean;
  size?: number;
  mtimeMs?: number;
  birthtimeMs?: number;
}

/** `stat` -- resolves `args.path` against the workspace root and returns
 * its metadata, or `{ exists: false }` if nothing is there. No lock is
 * acquired (reads are unmoderated, D9). */
export async function statPath(args: { path: string }): Promise<StatResult> {
  const resolved = resolveWorkspacePath(args.path);
  try {
    const st = await fs.stat(resolved);
    return {
      path: toWorkspaceRelative(resolved),
      exists: true,
      isFile: st.isFile(),
      isDirectory: st.isDirectory(),
      size: st.size,
      mtimeMs: st.mtimeMs,
      birthtimeMs: st.birthtimeMs,
    };
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return { path: toWorkspaceRelative(resolved), exists: false };
    }
    throw err;
  }
}

export interface MoveFileResult {
  source: string;
  destination: string;
  moved: true;
}

/** `move_file` -- resolves **both** `args.source` and `args.destination`
 * against the workspace root before any I/O, rejecting the call if
 * either escapes it (the "crafted `move_file` destination" case
 * architecture-001's Security Considerations calls out by name). Acquires
 * a `Lock` (`resourceType: 'directory'`, `resourceKey`: the resolved
 * workspace-relative destination path) around the rename, releasing it
 * whether the rename succeeds or throws. On success, records the change
 * with the Versioning Service after the filesystem mutation completes. */
export async function moveFile(
  args: { source: string; destination: string },
  options: FsToolsOptions = {}
): Promise<MoveFileResult> {
  const versioning = options.versioning ?? defaultVersioningService;
  const resolvedSource = resolveWorkspacePath(args.source);
  const resolvedDestination = resolveWorkspacePath(args.destination);
  const resourceKey = toWorkspaceRelative(resolvedDestination);

  await acquireLock('directory', resourceKey, options.lockHolder);
  try {
    await fs.mkdir(path.dirname(resolvedDestination), { recursive: true });
    await fs.rename(resolvedSource, resolvedDestination);
  } finally {
    await releaseLock('directory', resourceKey);
  }

  // Versioning hand-off happens only after the mutation has completed.
  versioning.recordChange(resolvedDestination);

  return {
    source: toWorkspaceRelative(resolvedSource),
    destination: toWorkspaceRelative(resolvedDestination),
    moved: true,
  };
}

export interface CreateDirectoryResult {
  path: string;
  created: true;
}

/** `create_directory` -- resolves `args.path` against the workspace root
 * before any I/O. Acquires a `Lock` (`resourceType: 'directory'`,
 * `resourceKey`: the resolved workspace-relative path) around the mkdir,
 * releasing it whether it succeeds or throws. On success, records the
 * change with the Versioning Service after the filesystem mutation
 * completes. */
export async function createDirectory(
  args: { path: string },
  options: FsToolsOptions = {}
): Promise<CreateDirectoryResult> {
  const versioning = options.versioning ?? defaultVersioningService;
  const resolved = resolveWorkspacePath(args.path);
  const resourceKey = toWorkspaceRelative(resolved);

  await acquireLock('directory', resourceKey, options.lockHolder);
  try {
    await fs.mkdir(resolved, { recursive: true });
  } finally {
    await releaseLock('directory', resourceKey);
  }

  versioning.recordChange(resolved);

  return { path: resourceKey, created: true };
}

/** Registers `read_file`, `move_file`, `create_directory`, `stat` -- and
 * no others -- on `server` (expected to be the `workspaceMcpServer`
 * instance from `./server.ts`, never the existing dev-tooling MCP
 * server). */
export function registerFsTools(server: McpServer, options: FsToolsOptions = {}) {
  server.tool(
    'read_file',
    'Read a file under the workspace root. Returns base64-encoded content.',
    { path: z.string().describe('Path relative to the workspace root') },
    async (args) => textResult(await readFile(args))
  );

  server.tool(
    'stat',
    'Get metadata for a path under the workspace root.',
    { path: z.string().describe('Path relative to the workspace root') },
    async (args) => textResult(await statPath(args))
  );

  server.tool(
    'move_file',
    'Move/rename a file or directory within the workspace root.',
    {
      source: z.string().describe('Source path relative to the workspace root'),
      destination: z.string().describe('Destination path relative to the workspace root'),
    },
    async (args) => textResult(await moveFile(args, options))
  );

  server.tool(
    'create_directory',
    'Create a directory (and any missing parents) under the workspace root.',
    { path: z.string().describe('Path relative to the workspace root') },
    async (args) => textResult(await createDirectory(args, options))
  );
}
