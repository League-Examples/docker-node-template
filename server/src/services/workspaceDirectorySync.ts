import fs from 'fs/promises';
import path from 'path';
import type { WorkspaceDirectoryModel } from '../generated/prisma/models';

/**
 * Workspace Filesystem sync utility (architecture-001 §File-System Layout,
 * decision D6: `WorkspaceDirectory` rows are canonical, `_dir.json` files
 * are a derived mirror for anyone browsing the raw tree outside the app).
 *
 * This module owns two things:
 *  - `resolveWorkspacePath`: the path-containment mechanism that resolves a
 *    relative path against the `workspace/` root and rejects anything that
 *    would escape it. Built here, in isolation from any agent/MCP code, so
 *    Sprint 003's Workspace MCP Server can reuse the exact same
 *    implementation for its own filesystem tools rather than re-deriving
 *    it (one implementation, one test suite).
 *  - `writeDirDescriptor` / `moveDirDescriptor`: the mirror-sync operations
 *    a caller runs after creating/moving a `WorkspaceDirectory` row so the
 *    on-disk `_dir.json` stays in step with the DB.
 */

export const DIR_DESCRIPTOR_FILENAME = '_dir.json';

/**
 * The enforced root all workspace paths are resolved against. Follows the
 * same "env var override, else a path relative to process.cwd()" pattern
 * as `BackupService`'s `BACKUP_DIR` (server/src/services/backup.service.ts)
 * — `WORKSPACE_DIR` defaults to `<cwd>/workspace`, placing it alongside the
 * `data/` directory the app-data volume already mounts in production.
 *
 * Computed fresh on every call (not cached at module load) so tests can
 * point `WORKSPACE_DIR` at a scratch directory per run.
 */
export function getWorkspaceRoot(): string {
  const configured = process.env.WORKSPACE_DIR;
  return path.resolve(configured || path.join(process.cwd(), 'workspace'));
}

/**
 * Resolve a path relative to the workspace root, rejecting anything that
 * would escape it — `../` traversal, an absolute path outside the root, or
 * a symlink is not followed/validated here (callers that need to guard
 * against symlink escapes should stat+realpath separately; this function
 * only guards the textual path).
 */
export function resolveWorkspacePath(relativePath: string): string {
  const root = getWorkspaceRoot();
  const resolved = path.resolve(root, relativePath);
  const relativeToRoot = path.relative(root, resolved);

  if (relativeToRoot !== '' && (relativeToRoot === '..' || relativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRoot))) {
    throw new Error(`Path escapes workspace root: ${relativePath}`);
  }

  return resolved;
}

type DirDescriptorSource = Pick<WorkspaceDirectoryModel, 'path' | 'descriptorJson'>;

/**
 * Write (or overwrite) the `_dir.json` mirror file for a `WorkspaceDirectory`
 * row at `dir.path`, with content matching `dir.descriptorJson`. Creates the
 * target directory if it does not already exist. Returns the file path
 * written.
 */
export async function writeDirDescriptor(dir: DirDescriptorSource): Promise<string> {
  const dirPath = resolveWorkspacePath(dir.path);
  await fs.mkdir(dirPath, { recursive: true });

  const filePath = path.join(dirPath, DIR_DESCRIPTOR_FILENAME);
  const content = dir.descriptorJson ?? {};
  await fs.writeFile(filePath, `${JSON.stringify(content, null, 2)}\n`, 'utf8');

  return filePath;
}

/**
 * Relocate a `WorkspaceDirectory` row's on-disk directory after its `path`
 * changes, so no orphaned `_dir.json` (or any other content already placed
 * under the old path) is left behind. Moves the whole directory — not just
 * `_dir.json` — because the row's `path` is the physical location of
 * everything filed under it, not just the descriptor file.
 *
 * A no-op if nothing exists at `oldPath` yet (still ensures `newPath`
 * exists, empty, ready for a subsequent `writeDirDescriptor`).
 */
export async function moveDirDescriptor(oldPath: string, newPath: string): Promise<void> {
  const oldDirPath = resolveWorkspacePath(oldPath);
  const newDirPath = resolveWorkspacePath(newPath);

  if (oldDirPath === newDirPath) return;

  await fs.mkdir(path.dirname(newDirPath), { recursive: true });

  try {
    await fs.rename(oldDirPath, newDirPath);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      // Nothing existed at the old path — just ensure the new directory exists.
      await fs.mkdir(newDirPath, { recursive: true });
      return;
    }
    throw err;
  }
}
