import '../env';
import fs from 'fs/promises';
import { prisma, initPrisma, disconnectPrisma } from '../services/prisma';
import { resolveWorkspacePath, writeDirDescriptor } from '../services/workspaceDirectorySync';

/**
 * Workspace filesystem scaffold (architecture-001 §File-System Layout;
 * this sprint's architecture-update.md, Workspace Filesystem module).
 *
 * Creates the top-level `workspace/` tree (`assets/`, `knowledge/`,
 * `projects/`, `exports/`) plus the initial category subdirectories under
 * `assets/` and `knowledge/`, each backed by a `WorkspaceDirectory` row and
 * a matching `_dir.json` mirror (via `workspaceDirectorySync`).
 *
 * Idempotent: re-running neither duplicates `WorkspaceDirectory` rows nor
 * produces conflicting `_dir.json` writes — an existing row is left as-is
 * (only its mirror file is re-synced, in case it drifted or is missing).
 *
 * Sprint 003's Workspace MCP Server becomes the real runtime writer of this
 * tree; this script only seeds the initial scaffold in isolation from any
 * agent/MCP code.
 */

// No WorkspaceDirectory row for these — they're plain organizational
// directories, not collections or knowledge categories (see schema.prisma
// comment on WorkspaceDirectory.kind: 'collection' | 'knowledge-category').
export const TOP_LEVEL_DIRECTORIES = ['assets', 'knowledge', 'projects', 'exports'] as const;

export interface CategoryDirectorySeed {
  relPath: string;
  kind: 'collection' | 'knowledge-category';
  name: string;
}

export const CATEGORY_DIRECTORIES: CategoryDirectorySeed[] = [
  { relPath: 'assets/logos', kind: 'collection', name: 'logos' },
  { relPath: 'assets/stock-art', kind: 'collection', name: 'stock-art' },
  { relPath: 'assets/prior-art', kind: 'collection', name: 'prior-art' },
  { relPath: 'knowledge/styles', kind: 'knowledge-category', name: 'styles' },
  { relPath: 'knowledge/palettes', kind: 'knowledge-category', name: 'palettes' },
  { relPath: 'knowledge/compositions', kind: 'knowledge-category', name: 'compositions' },
  { relPath: 'knowledge/layouts', kind: 'knowledge-category', name: 'layouts' },
];

export interface ScaffoldResult {
  created: number;
  resynced: number;
}

/** `client` defaults to the app's shared Prisma client; tests pass their own. */
export async function scaffoldWorkspaceDirectories(client: any = prisma): Promise<ScaffoldResult> {
  for (const top of TOP_LEVEL_DIRECTORIES) {
    await fs.mkdir(resolveWorkspacePath(top), { recursive: true });
  }

  let created = 0;
  let resynced = 0;

  for (const category of CATEGORY_DIRECTORIES) {
    const existing = await client.workspaceDirectory.findUnique({ where: { path: category.relPath } });

    if (existing) {
      await writeDirDescriptor(existing);
      resynced += 1;
      continue;
    }

    const row = await client.workspaceDirectory.create({
      data: {
        path: category.relPath,
        kind: category.kind,
        descriptorJson: { kind: category.kind, name: category.name },
      },
    });
    await writeDirDescriptor(row);
    created += 1;
  }

  return { created, resynced };
}

// Run directly (`tsx src/scripts/scaffold-workspace-directories.ts`), not on
// import — lets tests import the function above without side effects.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  (async () => {
    await initPrisma();
    try {
      const result = await scaffoldWorkspaceDirectories();
      console.log(`Workspace scaffold: ${result.created} directory row(s) created, ${result.resynced} already present (mirror re-synced).`);
    } finally {
      await disconnectPrisma();
    }
  })().catch((err) => {
    console.error('Workspace scaffold failed:', err);
    process.exit(1);
  });
}
