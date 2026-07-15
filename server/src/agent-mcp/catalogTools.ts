import fs from 'fs/promises';
import path from 'path';
import { createPatch, applyPatch } from 'diff';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { prisma as defaultPrisma } from '../services/prisma';
import { resolveWorkspacePath } from '../services/workspaceDirectorySync';
import { versioningService as defaultVersioningService } from '../services/versioning';
import { indexKnowledgeEntry } from '../services/search';
import { acquireLock, releaseLock } from './locks';
import type { VersioningRecorder } from './fsTools';
import type { KnowledgeEntryModel } from '../generated/prisma/models/KnowledgeEntry';
import type { KnowledgeCorrectionModel } from '../generated/prisma/models/KnowledgeCorrection';
import type { AssetModel } from '../generated/prisma/models/Asset';
import type { ProjectModel } from '../generated/prisma/models/Project';
import type { IterationModel } from '../generated/prisma/models/Iteration';

/**
 * Catalog tool family for the Workspace MCP Server (architecture-001
 * §Module 4, this sprint's ticket 003): `create_knowledge_entry`,
 * `propose_correction`, `resolve_correction`, `add_asset_to_collection`,
 * `create_project`, `create_iteration`, `create_agent_page` -- registered
 * on the same `workspaceMcpServer` instance ticket 002 built, reusing its
 * `locks.ts` helper and `resolveWorkspacePath` path-containment mechanism
 * (never reimplemented here).
 *
 * Talks to the Prisma client directly rather than through
 * `ServiceRegistry` -- these tools are MCP-tool-shaped, not request-scoped
 * CRUD services (architecture-update.md's Impact on Existing Components).
 *
 * **Optimistic locking (R3, reject-and-surface)**: `Project`/
 * `KnowledgeEntry` version-checked writes are a single conditional
 * `updateMany({ where: { id, version } })` call, never a separate
 * read-then-compare step -- a zero-row result means the caller's `version`
 * no longer matches the stored row, which is surfaced as a
 * `VersionConflictError` rather than silently discarded or retried. This
 * avoids a check-then-act race between the read and the write.
 *
 * `create_knowledge_entry` and `create_project` are each a *family* of one
 * tool covering two operations, distinguished by whether `id` is present
 * in the call: omitted `id` creates a new row; a supplied `id` (with the
 * required `version`) updates the existing row's non-`bodyText` metadata
 * fields. `create_knowledge_entry`'s update path explicitly rejects a
 * `bodyText` argument -- per architecture-001 D3 and this sprint's
 * corrections-as-diff-rows design, `bodyText` only ever changes through
 * `propose_correction` + `resolve_correction`, never a direct write from
 * chat.
 *
 * **Correction lifecycle (D3)**: `propose_correction` computes a unified
 * diff (via the `diff` package's `createPatch` -- a minimal, well-known
 * dependency chosen over hand-rolling unified-diff formatting/parsing,
 * see Design Rationale in ticket 003-003) between the entry's current
 * `bodyText` and the caller's proposed replacement text, and stores it on
 * a new `KnowledgeCorrection` row (`status: 'pending'`) -- the entry
 * itself is never touched by this call. `resolve_correction`'s accept
 * path applies that same diff with `applyPatch` and, if it still applies
 * cleanly, commits the result through the same version-checked
 * `updateMany` pattern as any other `KnowledgeEntry` write; the reject
 * path only ever changes the correction row's own `status`/`resolvedAt`.
 *
 * **Lock `resourceKey` convention (R5)**: for `KnowledgeEntry`/
 * `Collection`/`Asset` writes, the owning `WorkspaceDirectory`'s `path`
 * (already workspace-relative). For `Project`/`Iteration`/agent-page
 * writes, `projects/<id>` -- the numeric `Project.id` is used instead of a
 * human-readable slug because no `slug` field exists on `Project` (no
 * Prisma migration this sprint) and a title-derived slug would either
 * collide across same-titled projects or need its own uniqueness
 * bookkeeping this ticket doesn't need. Using the id keeps the Lock
 * `resourceKey`, the Versioning Service's recorded path, and the actual
 * on-disk path identical for every project-scoped write -- the same
 * "resourceKey equals the resolved workspace-relative path being written"
 * convention `fsTools.ts` already established.
 */

function textResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

/** Thrown when a version-checked write's supplied `version` no longer
 * matches the stored row -- the reject-and-surface conflict this sprint's
 * R3 requires, distinguishable from other errors so callers can catch it
 * specifically (mirrors `LockConflictError` in `./locks.ts`). */
export class VersionConflictError extends Error {
  readonly model: string;
  readonly id: number;
  readonly expectedVersion: number;

  constructor(model: string, id: number, expectedVersion: number) {
    super(
      `Version conflict on ${model} id=${id}: supplied version ${expectedVersion} no longer matches the stored row`
    );
    this.name = 'VersionConflictError';
    this.model = model;
    this.id = id;
    this.expectedVersion = expectedVersion;
  }
}

export interface CatalogToolsOptions {
  /** Versioning Service instance to call `recordChange` on after a
   * successful write. Defaults to the shared app singleton;
   * test-injectable. */
  versioning?: VersioningRecorder;
  /** Free-text `Lock.holder` value recorded on acquired locks, for
   * diagnostics only. */
  lockHolder?: string;
  /** Prisma client used for every catalog read/write. Defaults to the
   * shared app singleton; test-injectable. */
  prismaClient?: any;
}

/** The Lock/Versioning `resourceKey` for a project-scoped write --
 * `projects/<id>` (see module header for why an id, not a slug). */
function projectResourceKey(project: { id: number }): string {
  return `projects/${project.id}`;
}

/** `Iteration.seq` for the next iteration under `projectId`: one past the
 * highest existing `seq`, or `1` if none exist yet. Purely additive --
 * callers of this helper never update an existing row, so an existing
 * iteration's `imagePath` is never at risk of being overwritten. */
async function nextIterationSeq(prismaClient: any, projectId: number): Promise<number> {
  const last = await prismaClient.iteration.findFirst({
    where: { projectId },
    orderBy: { seq: 'desc' },
  });
  return (last?.seq ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// create_knowledge_entry
// ---------------------------------------------------------------------------

export interface CreateKnowledgeEntryArgs {
  /** Present only when updating an existing entry; requires `version`. */
  id?: number;
  /** Required when `id` is present: the version last read by the caller. */
  version?: number;
  /** Required to create a new entry. */
  directoryId?: number;
  /** Required to create a new entry. */
  kind?: string;
  /** Required to create a new entry. */
  name?: string;
  /** Required to create a new entry; rejected on update (D3 -- see module header). */
  bodyText?: string;
  structuredFields?: unknown;
}

/** `create_knowledge_entry` -- creates a new `KnowledgeEntry` (no `id`
 * argument), or updates an existing one's `kind`/`name`/`directoryId`/
 * `structuredFields` (an `id` + matching `version`) -- never `bodyText`,
 * which only changes via `propose_correction`/`resolve_correction`. */
export async function createKnowledgeEntry(
  args: CreateKnowledgeEntryArgs,
  options: CatalogToolsOptions = {}
): Promise<KnowledgeEntryModel> {
  const prismaClient = options.prismaClient ?? defaultPrisma;
  const versioning = options.versioning ?? defaultVersioningService;

  if (args.id !== undefined) {
    if (args.version === undefined) {
      throw new Error('create_knowledge_entry: version is required when id is provided');
    }
    if (args.bodyText !== undefined) {
      throw new Error(
        'create_knowledge_entry: bodyText cannot be set directly on an update -- use propose_correction/resolve_correction'
      );
    }
    const existing = await prismaClient.knowledgeEntry.findUnique({
      where: { id: args.id },
      include: { directory: true },
    });
    if (!existing) throw new Error(`create_knowledge_entry: no KnowledgeEntry with id ${args.id}`);

    const resourceKey = existing.directory.path;
    await acquireLock('directory', resourceKey, options.lockHolder, prismaClient);
    try {
      const updateData: Record<string, unknown> = {};
      if (args.kind !== undefined) updateData.kind = args.kind;
      if (args.name !== undefined) updateData.name = args.name;
      if (args.directoryId !== undefined) updateData.directoryId = args.directoryId;
      if (args.structuredFields !== undefined) updateData.structuredFields = args.structuredFields;

      const result = await prismaClient.knowledgeEntry.updateMany({
        where: { id: args.id, version: args.version },
        data: { ...updateData, version: { increment: 1 } },
      });
      if (result.count === 0) {
        throw new VersionConflictError('KnowledgeEntry', args.id, args.version);
      }
    } finally {
      await releaseLock('directory', resourceKey, prismaClient);
    }

    const updated = await prismaClient.knowledgeEntry.findUniqueOrThrow({ where: { id: args.id } });
    indexKnowledgeEntry({ id: updated.id, name: updated.name, bodyText: updated.bodyText });
    versioning.recordChange(resolveWorkspacePath(resourceKey));
    return updated;
  }

  if (args.directoryId === undefined || args.kind === undefined || args.name === undefined || args.bodyText === undefined) {
    throw new Error('create_knowledge_entry: directoryId, kind, name, and bodyText are required to create a new entry');
  }

  const directory = await prismaClient.workspaceDirectory.findUnique({ where: { id: args.directoryId } });
  if (!directory) throw new Error(`create_knowledge_entry: no WorkspaceDirectory with id ${args.directoryId}`);

  const resourceKey = directory.path;
  let entry: KnowledgeEntryModel;
  await acquireLock('directory', resourceKey, options.lockHolder, prismaClient);
  try {
    entry = await prismaClient.knowledgeEntry.create({
      data: {
        directoryId: args.directoryId,
        kind: args.kind,
        name: args.name,
        bodyText: args.bodyText,
        structuredFields: args.structuredFields,
      },
    });
  } finally {
    await releaseLock('directory', resourceKey, prismaClient);
  }

  indexKnowledgeEntry({ id: entry.id, name: entry.name, bodyText: entry.bodyText });
  versioning.recordChange(resolveWorkspacePath(resourceKey));
  return entry;
}

// ---------------------------------------------------------------------------
// propose_correction / resolve_correction
// ---------------------------------------------------------------------------

export interface ProposeCorrectionArgs {
  entryId: number;
  /** The entry's full proposed replacement text -- this function computes
   * the unified diff against the entry's current `bodyText` itself,
   * rather than requiring the caller to construct diff syntax. */
  proposedBodyText: string;
  proposedByUserId: number;
  contextProjectId?: number;
}

/** `propose_correction` -- creates a `pending` `KnowledgeCorrection`
 * holding a unified diff against the entry's current `bodyText`. Never
 * touches the entry itself (D3): a correction is a proposal requiring
 * `resolve_correction`, not an autonomous edit. */
export async function proposeCorrection(
  args: ProposeCorrectionArgs,
  options: CatalogToolsOptions = {}
): Promise<KnowledgeCorrectionModel> {
  const prismaClient = options.prismaClient ?? defaultPrisma;
  const versioning = options.versioning ?? defaultVersioningService;

  const entry = await prismaClient.knowledgeEntry.findUnique({
    where: { id: args.entryId },
    include: { directory: true },
  });
  if (!entry) throw new Error(`propose_correction: no KnowledgeEntry with id ${args.entryId}`);

  const diffText = createPatch(entry.name, entry.bodyText, args.proposedBodyText);
  const resourceKey = entry.directory.path;

  let correction: KnowledgeCorrectionModel;
  await acquireLock('directory', resourceKey, options.lockHolder, prismaClient);
  try {
    correction = await prismaClient.knowledgeCorrection.create({
      data: {
        entryId: args.entryId,
        proposedByUserId: args.proposedByUserId,
        contextProjectId: args.contextProjectId,
        diff: diffText,
      },
    });
  } finally {
    await releaseLock('directory', resourceKey, prismaClient);
  }

  versioning.recordChange(resolveWorkspacePath(resourceKey));
  return correction;
}

export interface ResolveCorrectionArgs {
  correctionId: number;
  action: 'accept' | 'reject';
}

/** `resolve_correction` -- accept path applies the correction's stored
 * diff to the entry's `bodyText` (via `applyPatch`) and bumps `version` by
 * exactly 1 through the same version-checked `updateMany` every other
 * `KnowledgeEntry` write uses; reject path changes only the correction's
 * own `status`/`resolvedAt`, leaving `bodyText`/`version` untouched. */
export async function resolveCorrection(
  args: ResolveCorrectionArgs,
  options: CatalogToolsOptions = {}
): Promise<KnowledgeCorrectionModel> {
  const prismaClient = options.prismaClient ?? defaultPrisma;
  const versioning = options.versioning ?? defaultVersioningService;

  const correction = await prismaClient.knowledgeCorrection.findUnique({
    where: { id: args.correctionId },
    include: { entry: { include: { directory: true } } },
  });
  if (!correction) throw new Error(`resolve_correction: no KnowledgeCorrection with id ${args.correctionId}`);
  if (correction.status !== 'pending') {
    throw new Error(`resolve_correction: correction ${args.correctionId} is already ${correction.status}`);
  }

  const entry = correction.entry;
  const resourceKey = entry.directory.path;
  const resolvedAt = new Date();

  let updatedCorrection: KnowledgeCorrectionModel;
  await acquireLock('directory', resourceKey, options.lockHolder, prismaClient);
  try {
    if (args.action === 'reject') {
      updatedCorrection = await prismaClient.knowledgeCorrection.update({
        where: { id: args.correctionId },
        data: { status: 'rejected', resolvedAt },
      });
    } else {
      const applied = applyPatch(entry.bodyText, correction.diff);
      if (applied === false) {
        throw new Error(
          `resolve_correction: correction ${args.correctionId}'s diff no longer applies cleanly to the entry's current bodyText`
        );
      }

      const result = await prismaClient.knowledgeEntry.updateMany({
        where: { id: entry.id, version: entry.version },
        data: { bodyText: applied, version: { increment: 1 } },
      });
      if (result.count === 0) {
        throw new VersionConflictError('KnowledgeEntry', entry.id, entry.version);
      }

      updatedCorrection = await prismaClient.knowledgeCorrection.update({
        where: { id: args.correctionId },
        data: { status: 'accepted', resolvedAt },
      });
    }
  } finally {
    await releaseLock('directory', resourceKey, prismaClient);
  }

  if (args.action === 'accept') {
    const updatedEntry = await prismaClient.knowledgeEntry.findUniqueOrThrow({ where: { id: entry.id } });
    indexKnowledgeEntry({ id: updatedEntry.id, name: updatedEntry.name, bodyText: updatedEntry.bodyText });
  }
  versioning.recordChange(resolveWorkspacePath(resourceKey));
  return updatedCorrection;
}

// ---------------------------------------------------------------------------
// add_asset_to_collection
// ---------------------------------------------------------------------------

export interface AddAssetToCollectionArgs {
  directoryId: number;
  collectionName: string;
  /** Only used if `collectionName` doesn't already exist under
   * `directoryId` -- see module docs on the create-missing-collection
   * choice. Defaults to `'stock-art'`. */
  collectionKind?: string;
  path: string;
  hash: string;
  mtime?: string;
  sourceIterationId?: number;
}

/** `add_asset_to_collection` -- creates an `Asset` row under a `Collection`
 * named `collectionName` inside `WorkspaceDirectory` `directoryId`.
 *
 * **Documented choice**: if no `Collection` with that name already exists
 * under `directoryId`, this tool creates one (using `collectionKind`,
 * default `'stock-art'`) rather than erroring -- an agent proposing a
 * never-seen collection name (e.g. a newly agreed-on grouping) shouldn't
 * need a separate round-trip tool call first. No `AssetDescription` row is
 * created (no vision-model call this sprint, Sprint 004 scope). */
export async function addAssetToCollection(
  args: AddAssetToCollectionArgs,
  options: CatalogToolsOptions = {}
): Promise<AssetModel> {
  const prismaClient = options.prismaClient ?? defaultPrisma;
  const versioning = options.versioning ?? defaultVersioningService;

  const directory = await prismaClient.workspaceDirectory.findUnique({ where: { id: args.directoryId } });
  if (!directory) throw new Error(`add_asset_to_collection: no WorkspaceDirectory with id ${args.directoryId}`);

  const resourceKey = directory.path;
  let asset: AssetModel;
  await acquireLock('directory', resourceKey, options.lockHolder, prismaClient);
  try {
    let collection = await prismaClient.collection.findFirst({
      where: { directoryId: args.directoryId, name: args.collectionName },
    });
    if (!collection) {
      collection = await prismaClient.collection.create({
        data: { directoryId: args.directoryId, name: args.collectionName, kind: args.collectionKind ?? 'stock-art' },
      });
    }

    asset = await prismaClient.asset.create({
      data: {
        collectionId: collection.id,
        sourceIterationId: args.sourceIterationId,
        path: args.path,
        hash: args.hash,
        mtime: args.mtime ? new Date(args.mtime) : new Date(),
      },
    });
  } finally {
    await releaseLock('directory', resourceKey, prismaClient);
  }

  versioning.recordChange(resolveWorkspacePath(resourceKey));
  return asset;
}

// ---------------------------------------------------------------------------
// create_project
// ---------------------------------------------------------------------------

export interface CreateProjectArgs {
  /** Present only when updating an existing project; requires `version`. */
  id?: number;
  version?: number;
  /** Required to create a new project. */
  title?: string;
  /** Required to create a new project. */
  ownerUserId?: number;
  parentProjectId?: number;
  detailsHeader?: unknown;
  status?: string;
}

/** `create_project` -- creates a new `Project` (no `id` argument,
 * optionally with `parentProjectId` for a subproject), or updates an
 * existing one's `title`/`status`/`detailsHeader`/`parentProjectId` (an
 * `id` + matching `version`). On create, also creates the project's
 * `projects/<id>/` directory (empty -- `create_iteration`/
 * `create_agent_page` populate it later) so later writes have a
 * guaranteed-existing parent. */
export async function createProject(
  args: CreateProjectArgs,
  options: CatalogToolsOptions = {}
): Promise<ProjectModel> {
  const prismaClient = options.prismaClient ?? defaultPrisma;
  const versioning = options.versioning ?? defaultVersioningService;

  if (args.id !== undefined) {
    if (args.version === undefined) {
      throw new Error('create_project: version is required when id is provided');
    }
    const existing = await prismaClient.project.findUnique({ where: { id: args.id } });
    if (!existing) throw new Error(`create_project: no Project with id ${args.id}`);

    const resourceKey = projectResourceKey(existing);
    await acquireLock('directory', resourceKey, options.lockHolder, prismaClient);
    try {
      const updateData: Record<string, unknown> = {};
      if (args.title !== undefined) updateData.title = args.title;
      if (args.status !== undefined) updateData.status = args.status;
      if (args.detailsHeader !== undefined) updateData.detailsHeader = args.detailsHeader;
      if (args.parentProjectId !== undefined) updateData.parentProjectId = args.parentProjectId;

      const result = await prismaClient.project.updateMany({
        where: { id: args.id, version: args.version },
        data: { ...updateData, version: { increment: 1 } },
      });
      if (result.count === 0) {
        throw new VersionConflictError('Project', args.id, args.version);
      }
    } finally {
      await releaseLock('directory', resourceKey, prismaClient);
    }

    const updated = await prismaClient.project.findUniqueOrThrow({ where: { id: args.id } });
    versioning.recordChange(resolveWorkspacePath(resourceKey));
    return updated;
  }

  if (args.title === undefined || args.ownerUserId === undefined) {
    throw new Error('create_project: title and ownerUserId are required to create a new project');
  }

  const project = await prismaClient.project.create({
    data: {
      title: args.title,
      ownerUserId: args.ownerUserId,
      parentProjectId: args.parentProjectId,
      detailsHeader: args.detailsHeader,
    },
  });

  const resourceKey = projectResourceKey(project);
  await acquireLock('directory', resourceKey, options.lockHolder, prismaClient);
  try {
    await fs.mkdir(resolveWorkspacePath(resourceKey), { recursive: true });
  } finally {
    await releaseLock('directory', resourceKey, prismaClient);
  }

  versioning.recordChange(resolveWorkspacePath(resourceKey));
  return project;
}

// ---------------------------------------------------------------------------
// create_iteration
// ---------------------------------------------------------------------------

export interface CreateIterationArgs {
  projectId: number;
  imagePath: string;
  promptUsed: string;
  modelParams?: unknown;
  /** Explicit sequence number; defaults to one past the project's current
   * highest `seq`. */
  seq?: number;
}

/** `create_iteration` -- always inserts a new `Iteration` row (no update
 * path exists on this tool), so an existing iteration's `imagePath` is
 * never at risk of being overwritten (matching Sprint 002's SUC-001
 * append-only guarantee). */
export async function createIteration(
  args: CreateIterationArgs,
  options: CatalogToolsOptions = {}
): Promise<IterationModel> {
  const prismaClient = options.prismaClient ?? defaultPrisma;
  const versioning = options.versioning ?? defaultVersioningService;

  const project = await prismaClient.project.findUnique({ where: { id: args.projectId } });
  if (!project) throw new Error(`create_iteration: no Project with id ${args.projectId}`);

  const resourceKey = projectResourceKey(project);
  let iteration: IterationModel;
  await acquireLock('directory', resourceKey, options.lockHolder, prismaClient);
  try {
    const seq = args.seq ?? (await nextIterationSeq(prismaClient, args.projectId));
    iteration = await prismaClient.iteration.create({
      data: {
        projectId: args.projectId,
        seq,
        imagePath: args.imagePath,
        promptUsed: args.promptUsed,
        modelParams: args.modelParams,
      },
    });
  } finally {
    await releaseLock('directory', resourceKey, prismaClient);
  }

  versioning.recordChange(resolveWorkspacePath(resourceKey));
  return iteration;
}

// ---------------------------------------------------------------------------
// create_agent_page
// ---------------------------------------------------------------------------

export interface CreateAgentPageArgs {
  projectId: number;
  /** File name (may include subdirectories) written under
   * `projects/<id>/outputs/`, e.g. `'postcard.html'`. */
  filename: string;
  /** Self-contained page definition -- markup/schema plus an optional
   * small script (generic mechanism only; no postcard-specific
   * content-generation logic, per this ticket's scope). */
  content: string;
  contentType?: string;
}

export interface CreateAgentPageResult {
  iteration: IterationModel;
  /** Workspace-relative path the page was written to. */
  path: string;
}

/** `create_agent_page` -- writes a page-definition file to
 * `projects/<id>/outputs/<filename>`, resolved through
 * `resolveWorkspacePath` (ticket 002's path-containment guarantee, reused
 * not re-derived) and locked/released via `locks.ts`, plus a minimal
 * output-metadata record folded into `Iteration` (architecture-001 Agent
 * Runtime Details: "no separate top-level entity needed"). */
export async function createAgentPage(
  args: CreateAgentPageArgs,
  options: CatalogToolsOptions = {}
): Promise<CreateAgentPageResult> {
  const prismaClient = options.prismaClient ?? defaultPrisma;
  const versioning = options.versioning ?? defaultVersioningService;

  const project = await prismaClient.project.findUnique({ where: { id: args.projectId } });
  if (!project) throw new Error(`create_agent_page: no Project with id ${args.projectId}`);

  const relPath = `${projectResourceKey(project)}/outputs/${args.filename}`;
  const resolved = resolveWorkspacePath(relPath);
  const resourceKey = relPath;

  let iteration: IterationModel;
  await acquireLock('directory', resourceKey, options.lockHolder, prismaClient);
  try {
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, args.content, 'utf8');

    const seq = await nextIterationSeq(prismaClient, args.projectId);
    iteration = await prismaClient.iteration.create({
      data: {
        projectId: args.projectId,
        seq,
        imagePath: resourceKey,
        promptUsed: `agent-page:${args.filename}`,
        modelParams: { kind: 'agent-page', filename: args.filename, contentType: args.contentType ?? null },
      },
    });
  } finally {
    await releaseLock('directory', resourceKey, prismaClient);
  }

  versioning.recordChange(resolved);
  return { iteration, path: resourceKey };
}

// ---------------------------------------------------------------------------
// MCP registration
// ---------------------------------------------------------------------------

/** Registers `create_knowledge_entry`, `propose_correction`,
 * `resolve_correction`, `add_asset_to_collection`, `create_project`,
 * `create_iteration`, `create_agent_page` -- and no others -- on `server`
 * (expected to be the `workspaceMcpServer` instance from `./server.ts`). */
export function registerCatalogTools(server: McpServer, options: CatalogToolsOptions = {}) {
  server.tool(
    'create_knowledge_entry',
    'Create a new KnowledgeEntry, or update an existing one\'s metadata (id + version; never bodyText -- use propose_correction/resolve_correction for that).',
    {
      id: z.number().int().optional().describe('Update an existing entry (requires version) instead of creating.'),
      version: z.number().int().optional().describe('Required with id: the version last read.'),
      directoryId: z.number().int().optional().describe('Required to create.'),
      kind: z.string().optional().describe('Required to create.'),
      name: z.string().optional().describe('Required to create.'),
      bodyText: z.string().optional().describe('Required to create; not accepted on update.'),
      structuredFields: z.any().optional(),
    },
    async (args) => textResult(await createKnowledgeEntry(args, options))
  );

  server.tool(
    'propose_correction',
    'Propose a correction to a KnowledgeEntry as a unified diff. Does not modify the entry.',
    {
      entryId: z.number().int(),
      proposedBodyText: z.string(),
      proposedByUserId: z.number().int(),
      contextProjectId: z.number().int().optional(),
    },
    async (args) => textResult(await proposeCorrection(args, options))
  );

  server.tool(
    'resolve_correction',
    'Accept or reject a pending KnowledgeCorrection. Accept applies the diff and bumps the entry version; reject only changes the correction status.',
    {
      correctionId: z.number().int(),
      action: z.enum(['accept', 'reject']),
    },
    async (args) => textResult(await resolveCorrection(args, options))
  );

  server.tool(
    'add_asset_to_collection',
    'Add an Asset row to a named Collection under a WorkspaceDirectory, creating the Collection if it does not already exist.',
    {
      directoryId: z.number().int(),
      collectionName: z.string(),
      collectionKind: z.string().optional(),
      path: z.string(),
      hash: z.string(),
      mtime: z.string().optional(),
      sourceIterationId: z.number().int().optional(),
    },
    async (args) => textResult(await addAssetToCollection(args, options))
  );

  server.tool(
    'create_project',
    'Create a new Project (optionally a subproject via parentProjectId), or update an existing one\'s metadata (id + version).',
    {
      id: z.number().int().optional(),
      version: z.number().int().optional(),
      title: z.string().optional(),
      ownerUserId: z.number().int().optional(),
      parentProjectId: z.number().int().optional(),
      detailsHeader: z.any().optional(),
      status: z.string().optional(),
    },
    async (args) => textResult(await createProject(args, options))
  );

  server.tool(
    'create_iteration',
    'Add a new Iteration row to a Project. Always inserts -- never overwrites an existing iteration.',
    {
      projectId: z.number().int(),
      imagePath: z.string(),
      promptUsed: z.string(),
      modelParams: z.any().optional(),
      seq: z.number().int().optional(),
    },
    async (args) => textResult(await createIteration(args, options))
  );

  server.tool(
    'create_agent_page',
    'Write a self-contained agent-authored page file to projects/<id>/outputs/ and record a minimal output-metadata Iteration row.',
    {
      projectId: z.number().int(),
      filename: z.string(),
      content: z.string(),
      contentType: z.string().optional(),
    },
    async (args) => textResult(await createAgentPage(args, options))
  );
}
