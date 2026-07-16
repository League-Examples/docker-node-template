import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { prisma as defaultPrisma } from '../services/prisma';
import { keywordSearch } from '../services/search';

/**
 * API Gateway's `catalog.ts` (architecture-update.md Step 3 API Gateway
 * section, Design Rationale **R6**; ticket 005). Completes
 * architecture-001 Module 2's original three-router shape
 * (`catalog.ts`/`projects.ts`/`chat.ts`) -- only `chat.ts` existed before
 * this ticket.
 *
 * Two read-only endpoints backing the library drawer (SUC-002) and the
 * project-list page's Library view (SUC-010/SUC-011):
 *
 *  - **`GET /api/catalog/tree`** -- the real category browser: every
 *    `WorkspaceDirectory` row (each `kind: 'collection'` directory
 *    carrying its `Collection`s and their `Asset`s; each
 *    `kind: 'knowledge-category'` directory carrying its
 *    `KnowledgeEntry` rows), read directly via Prisma.
 *  - **`GET /api/catalog/search?q=`** -- the literal filter-bar path
 *    (UC-014 secondary path), a thin passthrough to
 *    `services/search.ts`'s existing `keywordSearch` (FTS5) -- the same
 *    function `turn.ts`'s `retrieveKnowledge` already uses server-side
 *    for chat, now exposed for the client's own filter bar. Search is
 *    **not** reimplemented here.
 *
 * **D9 read/write asymmetry**: both handlers read straight from Prisma
 * and never acquire a `Lock`, never call `versioning.recordChange`, and
 * never touch the Workspace MCP Server -- reads bypass that moderated
 * write path by design, matching every other read route in this codebase
 * (`files.ts`, `agent-mcp/catalogTools.ts`'s `search_catalog`).
 *
 * Per **R6**, both endpoints inline full item detail
 * (`description`/`bodyText`/`tags`) rather than requiring a second
 * per-item detail request -- catalog content sizes are modest and no
 * wireframe has a "preview then drill in" two-step flow that would
 * benefit from deferring the fetch. Every asset item carries its
 * workspace-relative `path` so the client renders its image via ticket
 * 004's `GET /api/files/*`; the drawer's exact four-category grouping
 * (assets, examples, styles, projects -- usecases.md SUC-002) is a
 * client-side concern layered on top of this raw directory/collection/
 * knowledge-entry shape (the "projects" category comes from a different
 * model entirely -- `Project`/`projects.ts`, out of this ticket's scope,
 * which is limited to `WorkspaceDirectory`/`Collection`/`KnowledgeEntry`/
 * `Asset`).
 *
 * `requireAuth` only -- no `requireAdmin`, matching every other new route
 * in this sprint.
 */
export const catalogRouter = Router();

/** Last path segment of a workspace-relative directory path, e.g.
 * `'assets/stock-art'` -> `'stock-art'` -- a human-readable label the
 * client can show without re-deriving it from `path` itself. */
function directoryName(dirPath: string): string {
  const segments = dirPath.split('/').filter(Boolean);
  return segments.length ? segments[segments.length - 1] : dirPath;
}

/** Denormalizes an `Asset` row (optionally with its `AssetDescription`)
 * into the shape both endpoints below return -- shared so `/tree` and
 * `/search` never drift on what an asset item looks like. */
function toAssetItem(asset: any) {
  const item: Record<string, unknown> = {
    id: asset.id,
    path: asset.path,
    hash: asset.hash,
    mtime: asset.mtime instanceof Date ? asset.mtime.toISOString() : asset.mtime,
  };
  const description = asset.description;
  if (description) {
    item.description = description.description;
    item.tags = Array.isArray(description.tags) ? description.tags : [];
    item.isPhotograph = description.isPhotograph;
    item.isLogo = description.isLogo;
    item.style = description.style ?? null;
    item.peopleReal = description.peopleReal ?? null;
  }
  return item;
}

/** Denormalizes a `KnowledgeEntry` row into the shape both endpoints
 * below return. */
function toKnowledgeEntryItem(entry: any) {
  return {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    bodyText: entry.bodyText,
    structuredFields: entry.structuredFields ?? null,
  };
}

catalogRouter.get('/catalog/tree', requireAuth, async (_req, res) => {
  const directories = await defaultPrisma.workspaceDirectory.findMany({
    orderBy: { path: 'asc' },
    include: {
      collections: {
        orderBy: { name: 'asc' },
        include: {
          assets: {
            orderBy: { id: 'asc' },
            include: { description: true },
          },
        },
      },
      knowledgeEntries: {
        orderBy: { name: 'asc' },
      },
    },
  });

  // An empty catalog (no WorkspaceDirectory rows at all) naturally falls
  // out of `findMany` as `[]` -- no separate empty-state branch needed
  // (UC-002 E1).
  res.status(200).json({
    directories: directories.map((dir: (typeof directories)[number]) => ({
      id: dir.id,
      parentId: dir.parentId,
      path: dir.path,
      name: directoryName(dir.path),
      kind: dir.kind,
      collections: dir.collections.map((collection: (typeof dir.collections)[number]) => ({
        id: collection.id,
        name: collection.name,
        kind: collection.kind,
        assets: collection.assets.map(toAssetItem),
      })),
      knowledgeEntries: dir.knowledgeEntries.map(toKnowledgeEntryItem),
    })),
  });
});

catalogRouter.get('/catalog/search', requireAuth, async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) {
    // No query text to match -- an empty result set, not an error
    // (mirrors the no-results case below; UC-002 E1).
    res.status(200).json({ results: [] });
    return;
  }

  let matches;
  try {
    matches = keywordSearch(q);
  } catch {
    // Malformed FTS5 query syntax (e.g. unbalanced quotes in the raw
    // filter-bar text) -- surfaced as "no matches" rather than a 500, the
    // same empty-state UC-002 E1 asks for on the no-results path.
    res.status(200).json({ results: [] });
    return;
  }

  const assetIds = matches.filter((m) => m.ownerType === 'asset').map((m) => m.ownerId);
  const entryIds = matches.filter((m) => m.ownerType === 'knowledge_entry').map((m) => m.ownerId);

  const [assets, entries] = await Promise.all([
    assetIds.length
      ? defaultPrisma.asset.findMany({ where: { id: { in: assetIds } }, include: { description: true } })
      : Promise.resolve([]),
    entryIds.length
      ? defaultPrisma.knowledgeEntry.findMany({ where: { id: { in: entryIds } } })
      : Promise.resolve([]),
  ]);

  const assetById = new Map<number, any>(assets.map((a: any) => [a.id, a]));
  const entryById = new Map<number, any>(entries.map((e: any) => [e.id, e]));

  const results = matches
    .map((match) => {
      if (match.ownerType === 'asset') {
        const asset = assetById.get(match.ownerId);
        // A SearchIndex row whose owning Asset was since deleted (no
        // cascading FTS5 cleanup guaranteed at this scale) -- drop it
        // rather than surface a dangling reference.
        return asset ? { ownerType: 'asset' as const, ...toAssetItem(asset) } : null;
      }
      const entry = entryById.get(match.ownerId);
      return entry ? { ownerType: 'knowledge_entry' as const, ...toKnowledgeEntryItem(entry) } : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  res.status(200).json({ results });
});
