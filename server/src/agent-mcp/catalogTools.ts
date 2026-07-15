import fs from 'fs/promises';
import path from 'path';
import { createPatch, applyPatch } from 'diff';
import { z } from 'zod';
import pino from 'pino';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { prisma as defaultPrisma } from '../services/prisma';
import { resolveWorkspacePath } from '../services/workspaceDirectorySync';
import { versioningService as defaultVersioningService } from '../services/versioning';
import { indexKnowledgeEntry, nearestNeighbors, keywordSearch } from '../services/search';
import { describeAsset, retryPendingDescriptions, embedText } from '../services/description';
import type { DescribeAssetOptions, RetryPendingDescriptionsOptions } from '../services/description';
import { acquireLock, releaseLock } from './locks';
import type { VersioningRecorder } from './fsTools';
import type { KnowledgeEntryModel } from '../generated/prisma/models/KnowledgeEntry';
import type { KnowledgeCorrectionModel } from '../generated/prisma/models/KnowledgeCorrection';
import type { AssetModel } from '../generated/prisma/models/Asset';
import type { ProjectModel } from '../generated/prisma/models/Project';
import type { IterationModel } from '../generated/prisma/models/Iteration';
import type { ReferenceModel } from '../generated/prisma/models/Reference';

/**
 * Catalog tool family for the Workspace MCP Server (architecture-001
 * §Module 4, this sprint's ticket 003): `create_knowledge_entry`,
 * `propose_correction`, `resolve_correction`, `add_asset_to_collection`,
 * `create_project`, `create_iteration`, `create_agent_page` -- registered
 * on the same `workspaceMcpServer` instance ticket 002 built, reusing its
 * `locks.ts` helper and `resolveWorkspacePath` path-containment mechanism
 * (never reimplemented here).
 *
 * Sprint 005 ticket 002 adds four more tools to this same file/registry
 * (architecture-update.md's Workspace MCP Server section): `add_reference`,
 * `remove_reference`, `set_iteration_state` -- all locked/versioned writes
 * following the same conventions as the tools above -- and `search_catalog`,
 * a read-only, unlocked tool (D9, matching `fsTools.ts`'s `read_file`/`stat`)
 * that reuses `description.ts`'s `embedText` and `search.ts`'s
 * `nearestNeighbors`/`keywordSearch` rather than adding a new
 * embedding-API integration (see `search_catalog`'s own doc comment and
 * architecture-update.md R8).
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

/** The minimal logger shape `add_asset_to_collection`'s pipeline-failure
 * log line depends on -- narrow enough for a test to inject a plain stub,
 * mirroring `imaging.ts`'s `ImagingLogger`. */
export interface CatalogToolsLogger {
  error(obj: Record<string, unknown>, msg?: string): void;
}

const defaultLogger: CatalogToolsLogger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : process.env.LOG_LEVEL || 'info',
});

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
};

/** Best-effort MIME type for an asset's stored path, for the vision-model
 * payload built below -- mirrors `imaging.ts`'s own `mimeTypeForPath`
 * table (not reused directly: that one is private to `imaging.ts`, and
 * duplicating this small lookup avoids widening that module's exports for
 * a four-line table). */
function mimeTypeForAssetPath(assetPath: string): string {
  return MIME_BY_EXTENSION[path.extname(assetPath).toLowerCase()] ?? 'image/png';
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
  /** `add_asset_to_collection` only: options forwarded to the Description
   * & Embedding Pipeline's `describeAsset` call after the directory lock
   * is released. Production callers leave this unset -- the tool reads
   * the asset's bytes off the Workspace Filesystem itself and lets
   * `imaging.ts` fall back to its env-var credentials. Tests set
   * `describeAsset.input` (fixture bytes/URL) and
   * `describeAsset.imagingOptions.fetchImpl` (a stub) so no real
   * filesystem read or network call ever happens in the suite. */
  describeAsset?: Partial<DescribeAssetOptions>;
  /** `add_asset_to_collection` only: options forwarded to the
   * opportunistic-retry pass's `retryPendingDescriptions` call for any
   * other still-pending `Asset` already in the same `Collection` (ticket
   * 004-004). Production callers leave this unset -- `retryPendingDescriptions`
   * reads each pending asset's bytes off the Workspace Filesystem itself
   * by default. Tests set `retryPendingDescriptions.loadInput` to a stub
   * returning fixture bytes so the opportunistic pass never touches the
   * real filesystem either. */
  retryPendingDescriptions?: Partial<RetryPendingDescriptionsOptions>;
  /** Free-text log line target for a swallowed description-pipeline
   * failure (see `add_asset_to_collection`'s header). Defaults to a
   * pino instance silent under `NODE_ENV=test`; test-injectable. */
  logger?: CatalogToolsLogger;
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
 * need a separate round-trip tool call first.
 *
 * **Description & Embedding Pipeline hand-off (ticket 004-003, first real
 * implementation)**: once the `Asset` row is created and the directory
 * lock released (the `finally` block below, unchanged), this tool reads
 * the asset's image bytes off the Workspace Filesystem itself (the file
 * was already placed there before this call, by whichever tool wrote it)
 * and calls `description.describeAsset` -- *after* the lock release, so
 * the vision-model network call this triggers never holds up other
 * writers to the same directory (architecture-update.md Step 3, UC-008
 * E4). That call is wrapped in try/catch: a failure (network error,
 * timeout, malformed vision response, or a missing/unreadable asset file)
 * is logged and swallowed, never thrown out of this function -- the
 * `Asset` row this call already created and returned is unaffected. Per
 * architecture-update.md Step 6 **R2** ("pending description as absent
 * row"), an `Asset` left with no `AssetDescription` row *is* the
 * pending-retry state; ticket 004 builds the retry path that re-invokes
 * `describeAsset` against exactly that "asset with no description" query.
 * Tests bypass the filesystem read entirely by supplying
 * `options.describeAsset.input` directly (fixture bytes/URL) alongside a
 * stub `fetchImpl`, so no real file or network access ever happens in the
 * suite.
 *
 * **Opportunistic retry (ticket 004-004)**: after that hand-off (success or
 * swallowed failure), this tool also runs a best-effort
 * `description.retryPendingDescriptions` pass scoped to this asset's
 * `Collection` (excluding the asset just created) -- so any *other*
 * still-pending asset already in the collection gets a free retry attempt
 * piggybacked on this write, without a separate scheduled-job cycle. Like
 * the main pipeline call, this pass is wrapped in try/catch: a failure here
 * (or within the retry pass itself) is logged and swallowed, never thrown
 * out of this function -- it never blocks or fails this commit, leaving
 * those other assets pending for the next opportunistic or scheduled
 * retry. */
export async function addAssetToCollection(
  args: AddAssetToCollectionArgs,
  options: CatalogToolsOptions = {}
): Promise<AssetModel> {
  const prismaClient = options.prismaClient ?? defaultPrisma;
  const versioning = options.versioning ?? defaultVersioningService;
  const logger = options.logger ?? defaultLogger;

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

  try {
    const describeOptions = options.describeAsset ?? {};
    const input = describeOptions.input ?? {
      imageBytes: await fs.readFile(resolveWorkspacePath(asset.path)),
      mimeType: mimeTypeForAssetPath(asset.path),
    };
    await describeAsset(asset, { ...describeOptions, prismaClient, input });
  } catch (err) {
    logger.error(
      { err, assetId: asset.id, path: asset.path },
      'add_asset_to_collection: description pipeline failed; Asset committed without AssetDescription (pending retry, architecture-update.md R2)'
    );
  }

  try {
    await retryPendingDescriptions({
      prismaClient,
      collectionId: asset.collectionId,
      excludeAssetId: asset.id,
      logger,
      ...options.retryPendingDescriptions,
    });
  } catch (err) {
    logger.error(
      { err, assetId: asset.id, collectionId: asset.collectionId },
      'add_asset_to_collection: opportunistic description-retry pass failed; other pending Assets left for the next retry'
    );
  }

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
   * content-generation logic, per this ticket's scope). A `Buffer` is
   * accepted (ticket 006, `postcard.pdf`) and written verbatim with no
   * text-encoding pass -- `fs.writeFile`'s default `'utf8'` encoding for
   * string content would corrupt arbitrary binary bytes (any byte outside
   * the 7-bit ASCII range gets re-encoded as multi-byte UTF-8), which a
   * PDF's binary stream data cannot tolerate. */
  content: string | Buffer;
  contentType?: string;
  /** When `false`, skips creating the `Iteration` provenance row for this
   * write -- the file is still written, locked, and versioned normally.
   * Defaults to `true`, preserving the existing MCP `create_agent_page`
   * tool contract for agents (every agent-authored page still gets a
   * gallery-visible `Iteration` row; the exposed MCP tool never passes
   * this argument). Sprint 005 OOP follow-up (2026-07-15): `postcards.ts`'s
   * PUT/PDF routes pass `false` here -- `postcard-content.json`/
   * `postcard.html`/`postcard.pdf` are pipeline output *files*, not
   * gallery-worthy iterations, and recording one Iteration per autosave/
   * PDF-generate call was polluting the iteration gallery with
   * broken-image rows (see `postcards.ts`'s own module header, and
   * `routes/projects.ts`'s `PROJECT_DETAIL_INCLUDE`/`PROJECT_LIST_INCLUDE`
   * for the read-side filter that also guards against any legacy rows). */
  recordIteration?: boolean;
}

export interface CreateAgentPageResult {
  /** `null` when `recordIteration: false` was passed -- no `Iteration` row
   * was created for this write. */
  iteration: IterationModel | null;
  /** Workspace-relative path the page was written to. */
  path: string;
}

/** `create_agent_page` -- writes a page-definition file to
 * `projects/<id>/outputs/<filename>`, resolved through
 * `resolveWorkspacePath` (ticket 002's path-containment guarantee, reused
 * not re-derived) and locked/released via `locks.ts`, plus (by default) a
 * minimal output-metadata record folded into `Iteration` (architecture-001
 * Agent Runtime Details: "no separate top-level entity needed") -- unless
 * the caller passes `recordIteration: false` (see `CreateAgentPageArgs`'s
 * own doc comment). */
export async function createAgentPage(
  args: CreateAgentPageArgs,
  options: CatalogToolsOptions = {}
): Promise<CreateAgentPageResult> {
  const prismaClient = options.prismaClient ?? defaultPrisma;
  const versioning = options.versioning ?? defaultVersioningService;
  const recordIteration = args.recordIteration ?? true;

  const project = await prismaClient.project.findUnique({ where: { id: args.projectId } });
  if (!project) throw new Error(`create_agent_page: no Project with id ${args.projectId}`);

  const relPath = `${projectResourceKey(project)}/outputs/${args.filename}`;
  const resolved = resolveWorkspacePath(relPath);
  const resourceKey = relPath;

  let iteration: IterationModel | null = null;
  await acquireLock('directory', resourceKey, options.lockHolder, prismaClient);
  try {
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    if (Buffer.isBuffer(args.content)) {
      await fs.writeFile(resolved, args.content);
    } else {
      await fs.writeFile(resolved, args.content, 'utf8');
    }

    if (recordIteration) {
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
    }
  } finally {
    await releaseLock('directory', resourceKey, prismaClient);
  }

  versioning.recordChange(resolved);
  return { iteration, path: resourceKey };
}

// ---------------------------------------------------------------------------
// add_reference
// ---------------------------------------------------------------------------

export interface AddReferenceArgs {
  projectId: number;
  assetId: number;
  /** `'style' | 'composition' | 'template'` (per `Reference.role`'s
   * documented values in schema.prisma). */
  role: string;
}

/** `add_reference` -- creates a `Reference` row linking an `Asset` to a
 * `Project` with a `role`. `Reference` has existed in `schema.prisma`
 * since architecture-001 with zero prior writers outside generated Prisma
 * client code (confirmed by grep) -- this is its first real writer.
 * Lock/version pattern: same as `createIteration` -- locks `projects/<id>`
 * around the write; `Reference` has no `version` field, so there is no
 * optimistic-lock check to perform. */
export async function addReference(
  args: AddReferenceArgs,
  options: CatalogToolsOptions = {}
): Promise<ReferenceModel> {
  const prismaClient = options.prismaClient ?? defaultPrisma;
  const versioning = options.versioning ?? defaultVersioningService;

  const project = await prismaClient.project.findUnique({ where: { id: args.projectId } });
  if (!project) throw new Error(`add_reference: no Project with id ${args.projectId}`);

  const asset = await prismaClient.asset.findUnique({ where: { id: args.assetId } });
  if (!asset) throw new Error(`add_reference: no Asset with id ${args.assetId}`);

  const resourceKey = projectResourceKey(project);
  let reference: ReferenceModel;
  await acquireLock('directory', resourceKey, options.lockHolder, prismaClient);
  try {
    reference = await prismaClient.reference.create({
      data: { projectId: args.projectId, assetId: args.assetId, role: args.role },
    });
  } finally {
    await releaseLock('directory', resourceKey, prismaClient);
  }

  versioning.recordChange(resolveWorkspacePath(resourceKey));
  return reference;
}

// ---------------------------------------------------------------------------
// remove_reference
// ---------------------------------------------------------------------------

export interface RemoveReferenceArgs {
  referenceId: number;
}

export interface RemoveReferenceResult {
  id: number;
  deleted: true;
}

/** `remove_reference` -- deletes exactly the targeted `Reference` row.
 * Lock/version pattern: same as `add_reference` -- locks the owning
 * project's `projects/<id>` resourceKey (looked up from the row itself,
 * since the caller only supplies `referenceId`) around the delete; no
 * `version` field to check. */
export async function removeReference(
  args: RemoveReferenceArgs,
  options: CatalogToolsOptions = {}
): Promise<RemoveReferenceResult> {
  const prismaClient = options.prismaClient ?? defaultPrisma;
  const versioning = options.versioning ?? defaultVersioningService;

  const existing = await prismaClient.reference.findUnique({ where: { id: args.referenceId } });
  if (!existing) throw new Error(`remove_reference: no Reference with id ${args.referenceId}`);

  const project = await prismaClient.project.findUnique({ where: { id: existing.projectId } });
  if (!project) throw new Error(`remove_reference: no Project with id ${existing.projectId}`);

  const resourceKey = projectResourceKey(project);
  await acquireLock('directory', resourceKey, options.lockHolder, prismaClient);
  try {
    await prismaClient.reference.delete({ where: { id: args.referenceId } });
  } finally {
    await releaseLock('directory', resourceKey, prismaClient);
  }

  versioning.recordChange(resolveWorkspacePath(resourceKey));
  return { id: args.referenceId, deleted: true };
}

// ---------------------------------------------------------------------------
// set_iteration_state
// ---------------------------------------------------------------------------

export interface SetIterationStateArgs {
  iterationId: number;
  accepted?: boolean;
  /** `'front' | 'back' | null` -- `null` clears this iteration's own role
   * without affecting any other iteration. */
  role?: 'front' | 'back' | null;
}

/** `set_iteration_state` -- updates `Iteration.accepted`/`Iteration.role`
 * (ticket 001's new columns) inside one `prisma.$transaction`, the *sole*
 * enforcement point (architecture-update.md R4: an application-level
 * invariant, not a DB constraint) for two independent exclusivity rules
 * from stakeholder rounds 6-7:
 *
 *  - setting `accepted: true` on one iteration clears `accepted` from
 *    every *other* iteration in the *same* project (an iteration in a
 *    different project is never touched);
 *  - setting `role: 'front'` (or `'back'`) on one iteration clears that
 *    *same* role from whichever other iteration in the same project
 *    previously held it -- `'front'` and `'back'` are independently
 *    exclusive, so setting one never disturbs whoever currently holds the
 *    other.
 *
 * Passing `accepted: false` or `role: null` only ever changes this
 * iteration's own row -- there is no other row to clear when turning a
 * flag *off*. Lock/version pattern: locks `projects/<id>` (looked up via
 * the iteration's own `projectId`) around the whole transaction, matching
 * every other project-scoped write in this file. */
export async function setIterationState(
  args: SetIterationStateArgs,
  options: CatalogToolsOptions = {}
): Promise<IterationModel> {
  const prismaClient = options.prismaClient ?? defaultPrisma;
  const versioning = options.versioning ?? defaultVersioningService;

  if (args.accepted === undefined && args.role === undefined) {
    throw new Error('set_iteration_state: at least one of accepted or role must be provided');
  }

  const existing = await prismaClient.iteration.findUnique({ where: { id: args.iterationId } });
  if (!existing) throw new Error(`set_iteration_state: no Iteration with id ${args.iterationId}`);

  const project = await prismaClient.project.findUnique({ where: { id: existing.projectId } });
  if (!project) throw new Error(`set_iteration_state: no Project with id ${existing.projectId}`);

  const resourceKey = projectResourceKey(project);
  let updated: IterationModel;
  await acquireLock('directory', resourceKey, options.lockHolder, prismaClient);
  try {
    updated = await prismaClient.$transaction(async (tx: any) => {
      if (args.accepted === true) {
        await tx.iteration.updateMany({
          where: { projectId: existing.projectId, id: { not: args.iterationId }, accepted: true },
          data: { accepted: false },
        });
      }
      if (args.role === 'front' || args.role === 'back') {
        await tx.iteration.updateMany({
          where: { projectId: existing.projectId, id: { not: args.iterationId }, role: args.role },
          data: { role: null },
        });
      }

      const updateData: Record<string, unknown> = {};
      if (args.accepted !== undefined) updateData.accepted = args.accepted;
      if (args.role !== undefined) updateData.role = args.role;

      return tx.iteration.update({ where: { id: args.iterationId }, data: updateData });
    });
  } finally {
    await releaseLock('directory', resourceKey, prismaClient);
  }

  versioning.recordChange(resolveWorkspacePath(resourceKey));
  return updated;
}

// ---------------------------------------------------------------------------
// remove_iteration
// ---------------------------------------------------------------------------

export interface RemoveIterationArgs {
  iterationId: number;
}

export interface RemoveIterationResult {
  id: number;
  deleted: true;
}

/** `remove_iteration` -- deletes exactly the targeted `Iteration` row
 * (OOP follow-up, 2026-07-15: `OutputPane.tsx`'s per-row Delete control,
 * with a client-side confirmation popup before this ever fires). Lock
 * pattern: same as `set_iteration_state` -- locks the owning project's
 * `projects/<id>` resourceKey (looked up from the row itself, since the
 * caller only supplies `iterationId`) around the delete; `Iteration` has no
 * `version` field, so there is no optimistic-lock check to perform.
 *
 * Also attempts to remove the backing image file at the iteration's
 * `imagePath`, but only *after* the row is deleted and the lock released,
 * and only best-effort: an already-missing file (or any other filesystem
 * error) is swallowed, never thrown out of this function -- the row
 * deletion this call already committed is the operation the caller is
 * waiting on, not the on-disk cleanup. */
export async function removeIteration(
  args: RemoveIterationArgs,
  options: CatalogToolsOptions = {}
): Promise<RemoveIterationResult> {
  const prismaClient = options.prismaClient ?? defaultPrisma;
  const versioning = options.versioning ?? defaultVersioningService;
  const logger = options.logger ?? defaultLogger;

  const existing = await prismaClient.iteration.findUnique({ where: { id: args.iterationId } });
  if (!existing) throw new Error(`remove_iteration: no Iteration with id ${args.iterationId}`);

  const project = await prismaClient.project.findUnique({ where: { id: existing.projectId } });
  if (!project) throw new Error(`remove_iteration: no Project with id ${existing.projectId}`);

  const resourceKey = projectResourceKey(project);
  await acquireLock('directory', resourceKey, options.lockHolder, prismaClient);
  try {
    await prismaClient.iteration.delete({ where: { id: args.iterationId } });
  } finally {
    await releaseLock('directory', resourceKey, prismaClient);
  }

  versioning.recordChange(resolveWorkspacePath(resourceKey));

  try {
    await fs.unlink(resolveWorkspacePath(existing.imagePath));
  } catch (err) {
    logger.error(
      { err, iterationId: args.iterationId, imagePath: existing.imagePath },
      'remove_iteration: backing file removal failed or file already absent; Iteration row deletion is unaffected'
    );
  }

  return { id: args.iterationId, deleted: true };
}

// ---------------------------------------------------------------------------
// remove_project
// ---------------------------------------------------------------------------

export interface RemoveProjectArgs {
  projectId: number;
}

export interface RemoveProjectResult {
  id: number;
  deleted: true;
}

/** `remove_project` -- OOP follow-up (2026-07-15): `ProjectList.tsx`'s
 * bulk-select Delete action, gated behind a client-side confirmation popup
 * before this ever fires. Deletes a `Project` row along with its dependent
 * `ChatMessage`/`Reference`/`Iteration` rows first -- none of those
 * `projectId` foreign keys cascade on delete (`schema.prisma` defines no
 * `onDelete` behavior on any of them), so deleting the `Project` row before
 * its children would fail the FK constraint. Lock pattern: same `directory`
 * resourceKey lock as `create_project`/`remove_iteration`, keyed by
 * `projects/<id>`, held around the whole delete.
 *
 * Also attempts to remove the project's entire workspace directory
 * (`projects/<id>/`, recursively) after the row deletion and lock release,
 * but only best-effort -- an already-missing directory (or any other
 * filesystem error) is swallowed, never thrown out of this function, same
 * as `remove_iteration`'s backing-file cleanup above. */
export async function removeProject(
  args: RemoveProjectArgs,
  options: CatalogToolsOptions = {}
): Promise<RemoveProjectResult> {
  const prismaClient = options.prismaClient ?? defaultPrisma;
  const versioning = options.versioning ?? defaultVersioningService;
  const logger = options.logger ?? defaultLogger;

  const existing = await prismaClient.project.findUnique({ where: { id: args.projectId } });
  if (!existing) throw new Error(`remove_project: no Project with id ${args.projectId}`);

  const resourceKey = projectResourceKey(existing);
  await acquireLock('directory', resourceKey, options.lockHolder, prismaClient);
  try {
    await prismaClient.chatMessage.deleteMany({ where: { projectId: args.projectId } });
    await prismaClient.reference.deleteMany({ where: { projectId: args.projectId } });
    await prismaClient.iteration.deleteMany({ where: { projectId: args.projectId } });
    await prismaClient.project.delete({ where: { id: args.projectId } });
  } finally {
    await releaseLock('directory', resourceKey, prismaClient);
  }

  versioning.recordChange(resolveWorkspacePath(resourceKey));

  try {
    await fs.rm(resolveWorkspacePath(resourceKey), { recursive: true, force: true });
  } catch (err) {
    logger.error(
      { err, projectId: args.projectId, resourceKey },
      'remove_project: workspace directory removal failed or already absent; Project row deletion is unaffected'
    );
  }

  return { id: args.projectId, deleted: true };
}

// ---------------------------------------------------------------------------
// search_catalog
// ---------------------------------------------------------------------------

export interface SearchCatalogArgs {
  query: string;
  /** Max results per underlying search path before merging/deduping.
   * Defaults to `DEFAULT_SEARCH_K`. */
  k?: number;
}

export interface SearchCatalogMatch {
  ownerType: string;
  ownerId: number;
  /** Which underlying search path(s) surfaced this `(ownerType, ownerId)`
   * pair -- a match found by both is listed once with both entries, not
   * duplicated. */
  matchedVia: ('vector' | 'keyword')[];
  /** Cosine similarity from the vector path, in [-1, 1]; absent for a
   * match the keyword path alone surfaced. */
  score?: number;
  /** `Asset.path`, for an `ownerType: 'asset'` match only. */
  path?: string;
  /** Denormalized human-readable label: an asset's description text, or a
   * knowledge entry's name -- enough for the client to render/highlight
   * the match without a second lookup. */
  label?: string;
}

const DEFAULT_SEARCH_K = 10;

/** `search_catalog` -- **read-only, no lock** (same D9-consistent pattern
 * as `fsTools.ts`'s `read_file`/`stat`, not the write tools above).
 *
 * Embeds `query` via `description.ts`'s existing, already-implemented
 * `embedText` -- **not** a new embedding-API call. `embedText` is the
 * only function that has ever produced an `Embedding` row (see
 * `description.ts`'s module header), so query-time text has to go through
 * that same deterministic hash-based function to land in the same
 * embedding space as the stored vectors; mixing in a real embedding model
 * for queries against hash-based stored vectors would make results worse,
 * not better (architecture-update.md R8). The resulting vector is run
 * through `search.ts`'s `nearestNeighbors`, and the raw query text is run
 * through `search.ts`'s `keywordSearch` (FTS5) -- both existing, already-
 * implemented, purely-local functions; this tool makes zero network calls.
 *
 * The two result sets are merged/deduped by `(ownerType, ownerId)`
 * (architecture-001's "FTS5 as a cheap pre-filter... hybrid retrieval"),
 * then denormalized with enough fields (`path`/`label`) for the client to
 * render a match without a second round-trip. */
export async function searchCatalog(
  args: SearchCatalogArgs,
  options: CatalogToolsOptions = {}
): Promise<SearchCatalogMatch[]> {
  const prismaClient = options.prismaClient ?? defaultPrisma;
  const k = args.k ?? DEFAULT_SEARCH_K;

  const queryVector = embedText(args.query);
  const vectorResults = await nearestNeighbors(queryVector, k);
  const keywordResults = keywordSearch(args.query, { limit: k });

  const merged = new Map<string, SearchCatalogMatch>();
  for (const r of vectorResults) {
    merged.set(`${r.ownerType}:${r.ownerId}`, {
      ownerType: r.ownerType,
      ownerId: r.ownerId,
      score: r.score,
      matchedVia: ['vector'],
    });
  }
  for (const r of keywordResults) {
    const key = `${r.ownerType}:${r.ownerId}`;
    const existing = merged.get(key);
    if (existing) {
      existing.matchedVia.push('keyword');
    } else {
      merged.set(key, { ownerType: r.ownerType, ownerId: r.ownerId, matchedVia: ['keyword'] });
    }
  }

  const matches = Array.from(merged.values());

  const assetIds = matches.filter((m) => m.ownerType === 'asset').map((m) => m.ownerId);
  const entryIds = matches.filter((m) => m.ownerType === 'knowledge_entry').map((m) => m.ownerId);

  const [assets, entries] = await Promise.all([
    assetIds.length
      ? prismaClient.asset.findMany({ where: { id: { in: assetIds } }, include: { description: true } })
      : Promise.resolve([]),
    entryIds.length ? prismaClient.knowledgeEntry.findMany({ where: { id: { in: entryIds } } }) : Promise.resolve([]),
  ]);

  const assetById = new Map<number, any>(assets.map((a: any) => [a.id, a]));
  const entryById = new Map<number, any>(entries.map((e: any) => [e.id, e]));

  for (const match of matches) {
    if (match.ownerType === 'asset') {
      const asset = assetById.get(match.ownerId);
      if (asset) {
        match.path = asset.path;
        match.label = asset.description?.description;
      }
    } else if (match.ownerType === 'knowledge_entry') {
      const entry = entryById.get(match.ownerId);
      if (entry) {
        match.label = entry.name;
      }
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// MCP registration
// ---------------------------------------------------------------------------

/** Registers `create_knowledge_entry`, `propose_correction`,
 * `resolve_correction`, `add_asset_to_collection`, `create_project`,
 * `create_iteration`, `create_agent_page`, `add_reference`,
 * `remove_reference`, `set_iteration_state`, `remove_iteration`,
 * `remove_project`, `search_catalog` -- and no others -- on `server`
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

  server.tool(
    'add_reference',
    "Create a Reference row linking an Asset to a Project with a role ('style' | 'composition' | 'template').",
    {
      projectId: z.number().int(),
      assetId: z.number().int(),
      role: z.string(),
    },
    async (args) => textResult(await addReference(args, options))
  );

  server.tool(
    'remove_reference',
    'Delete a Reference row by id.',
    {
      referenceId: z.number().int(),
    },
    async (args) => textResult(await removeReference(args, options))
  );

  server.tool(
    'set_iteration_state',
    "Update an Iteration's accepted/role flags. Setting accepted: true clears accepted from every other Iteration in the same project; setting role: 'front' (or 'back') clears that same role from whichever other Iteration in the same project held it. 'front' and 'back' are independently exclusive.",
    {
      iterationId: z.number().int(),
      accepted: z.boolean().optional(),
      role: z.enum(['front', 'back']).nullable().optional(),
    },
    async (args) => textResult(await setIterationState(args, options))
  );

  server.tool(
    'remove_iteration',
    'Delete an Iteration row by id, and best-effort remove its backing image file.',
    {
      iterationId: z.number().int(),
    },
    async (args) => textResult(await removeIteration(args, options))
  );

  server.tool(
    'remove_project',
    'Delete a Project row by id, along with its dependent ChatMessage/Reference/Iteration rows, and best-effort remove its workspace directory.',
    {
      projectId: z.number().int(),
    },
    async (args) => textResult(await removeProject(args, options))
  );

  server.tool(
    'search_catalog',
    'Hybrid vector + keyword search over the Catalog & Knowledge Store (Asset/KnowledgeEntry rows), merged and deduped by (ownerType, ownerId).',
    {
      query: z.string(),
      k: z.number().int().optional(),
    },
    async (args) => textResult(await searchCatalog(args, options))
  );
}
