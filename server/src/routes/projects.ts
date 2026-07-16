import fs from 'fs/promises';
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { prisma as defaultPrisma } from '../services/prisma';
import {
  createProject,
  addReference,
  removeReference,
  setIterationState,
  removeIteration,
  removeProject,
  VersionConflictError,
} from '../agent-mcp/catalogTools';
import { LockConflictError } from '../agent-mcp/locks';
import { resolveWorkspacePath } from '../services/workspaceDirectorySync';
import { parsePostcardContent, type PostcardContent } from '../services/postcardRender';

/**
 * API Gateway's `projects.ts` (architecture-update.md Step 3 API Gateway
 * section, **R1**; ticket 006). Completes architecture-001 Module 2's
 * three-router shape (`catalog.ts`/`projects.ts`/`chat.ts`) alongside
 * ticket 005's `catalog.ts`.
 *
 * Every write handler below calls a Workspace MCP Server tool function
 * (`agent-mcp/catalogTools.ts`, ticket 002) in-process -- never writes
 * `Project`/`Reference`/`Iteration` rows via raw Prisma -- mirroring
 * Sprint 004's `postcards.ts` precedent (**R1**). Reads (`GET /projects`,
 * `GET /projects/:id`, and the existence checks each write handler below
 * performs before delegating to a tool) go straight to Prisma, matching
 * every other read path in this codebase (D9).
 *
 * **`GET /api/projects/:id`** is the single source that rehydrates a
 * `ProjectDetail` page on load -- it inlines `iterations`, `references`,
 * *and* `chatMessages` in one response (tightened during architecture
 * review; SUC-005's "reopening a project renders [chat history]
 * immediately... not re-fetched separately").
 *
 * **`GET /api/projects`** also inlines each row's `iterations` and
 * `owner` (added during ticket 008): `ProjectList`'s hero-image rule
 * (SUC-010 -- most-recently-accepted iteration, front-over-back for
 * postcards, fallback to the last iteration) and its "All projects"
 * owner label both need that data on the list response itself, not a
 * follow-up per-project fetch (see `PROJECT_LIST_INCLUDE` below). It also
 * inlines each row's `postcardContent` (OOP change, 2026-07-15): the saved
 * `postcard-content.json` (if any), read from the workspace alongside the
 * Prisma query, so `ProjectList.tsx`'s hero card can overlay saved
 * text/QR on the hero image via the same read-only `PostcardOverlay`
 * `OutputPane.tsx`'s iteration gallery already uses (see
 * `readListPostcardContent` below).
 *
 * **`requireAuth` only** -- matching every other new/relaxed route in
 * this sprint (architecture-001's shared-trust model: no per-user
 * isolation below USER/ADMIN).
 */
export const projectsRouter = Router();

/** Maps a `catalogTools.ts` tool function's thrown error to an HTTP
 * status code. These tools throw plain `Error`s for "no <Model> with id
 * <n>" lookups and argument-validation failures (never a custom class --
 * see that file's header), plus the two named conflict classes
 * (`VersionConflictError`/`LockConflictError`) for the optimistic-lock and
 * `Lock`-row cases. `VersionConflictError` can only occur via
 * `create_project`'s *update* path (an `id`+`version` argument), which
 * this router's `POST /projects` never exercises (it only ever creates),
 * but the mapping is included for completeness/future-proofing. */
function statusForToolError(err: unknown): number {
  if (err instanceof VersionConflictError) return 409;
  if (err instanceof LockConflictError) return 409;
  if (err instanceof Error && /no \S+ with id/i.test(err.message)) return 404;
  return 400;
}

function toolErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unexpected error';
}

/** Excludes `create_agent_page`'s agent-page output rows (`promptUsed`
 * prefixed `agent-page:`, e.g. `postcard-content.json`/`postcard.html`/
 * `postcard.pdf`) from both includes below (OOP follow-up, 2026-07-15).
 * `postcards.ts` no longer creates these going forward (its
 * `create_agent_page` calls pass `recordIteration: false`), but this
 * filter also guards against any rows an older build already wrote --
 * without it, `OutputPane.tsx`'s gallery and `ProjectList.tsx`'s hero-image
 * rule would render them as broken images (they point at an HTML/JSON/PDF
 * file, not an image). SQLite's Prisma driver translates `startsWith` to a
 * `LIKE 'agent-page:%'` clause, so this runs entirely in the query, not as
 * an application-level post-filter. */
const EXCLUDE_AGENT_PAGE_ITERATIONS = {
  where: { promptUsed: { not: { startsWith: 'agent-page:' } } },
  orderBy: { seq: 'asc' as const },
};

const PROJECT_DETAIL_INCLUDE = {
  iterations: EXCLUDE_AGENT_PAGE_ITERATIONS,
  // `asset: { select: ... } }` added by ticket 009 (deviation from ticket
  // 006's original shape, documented in that ticket's file): the
  // ProjectDetail reference strip renders a small thumbnail per attached
  // reference, which needs the Asset's `path` for `GET /api/files/*` --
  // the bare `Reference` row alone (assetId only) can't render an image.
  references: { orderBy: { id: 'asc' as const }, include: { asset: { select: { id: true, path: true } } } },
  chatMessages: { orderBy: { createdAt: 'asc' as const } },
};

/** `GET /projects`'s own, slimmer include -- ticket 008's project-list
 * home page needs each row's `iterations` to compute its hero image
 * (SUC-010's accepted/front-over-back/fallback-to-last rule) and its
 * `owner` to label cards in the "All" view, but not the full
 * `references`/`chatMessages` fan-out `PROJECT_DETAIL_INCLUDE` carries --
 * those are `ProjectDetail`-only concerns. */
const PROJECT_LIST_INCLUDE = {
  owner: { select: { id: true, email: true, displayName: true } },
  iterations: EXCLUDE_AGENT_PAGE_ITERATIONS,
};

/** Reads back whatever `postcard-content.json` `postcards.ts`'s `PUT
 * /api/postcards/:projectId` most recently persisted for `projectId`, for
 * `GET /projects`'s list-include extension below (OOP change,
 * 2026-07-15). Reuses the exact same `resolveWorkspacePath` + `fs.readFile`
 * + `parsePostcardContent` read `postcards.ts`'s own `GET
 * /postcards/:projectId` route already does -- but, unlike that route,
 * EVERY failure mode here (no file yet, a JSON parse error, or a
 * `PostcardValidationError` from a malformed stored file) collapses to
 * `null` rather than surfacing an error. This is a bulk list response
 * covering many projects in one round trip; one project's corrupted or
 * absent `postcard-content.json` must never fail the whole `GET /projects`
 * response for every other project in the list -- it should just fall back
 * to `ProjectList.tsx`'s existing bare-image behavior for that one card,
 * exactly like `OutputPane.tsx`'s own swallow-on-error hydration effect
 * already does for the single-project detail view. */
async function readListPostcardContent(projectId: number): Promise<PostcardContent | null> {
  const contentPath = `projects/${projectId}/outputs/postcard-content.json`;
  let raw: string;
  try {
    raw = await fs.readFile(resolveWorkspacePath(contentPath), 'utf8');
  } catch {
    return null;
  }
  try {
    return parsePostcardContent(JSON.parse(raw));
  } catch {
    return null;
  }
}

projectsRouter.get('/projects', requireAuth, async (req, res) => {
  const userId = (req.user as any).id;
  const view = req.query.view === 'all' || req.query.view === 'archive' ? req.query.view : 'mine';

  const where =
    view === 'all'
      ? {}
      : view === 'archive'
        ? { status: 'archived' }
        : { ownerUserId: userId, status: { not: 'archived' } };

  const projects = await defaultPrisma.project.findMany({
    where,
    orderBy: { id: 'desc' },
    include: PROJECT_LIST_INCLUDE,
  });

  // `postcardContent` (OOP change, 2026-07-15): each row's saved postcard
  // content JSON, read in parallel alongside the Prisma query results
  // above, so `ProjectList.tsx`'s new hero-card text/QR overlay
  // (`PostcardOverlay`, the same read-only renderer `OutputPane.tsx`'s
  // iteration gallery already uses) has everything it needs in this one
  // response -- no follow-up `GET /api/postcards/:id` per visible card.
  // List-only, deliberately: `GET /projects/:id`'s `PROJECT_DETAIL_INCLUDE`
  // is untouched, since `PostcardEdit.tsx`/`OutputPane.tsx` already fetch
  // this themselves via `GET /api/postcards/:projectId` and don't need it
  // duplicated onto the detail response.
  const projectsWithPostcardContent = await Promise.all(
    projects.map(async (project: (typeof projects)[number]) => ({
      ...project,
      postcardContent: await readListPostcardContent(project.id),
    })),
  );

  res.status(200).json({ projects: projectsWithPostcardContent });
});

projectsRouter.get('/projects/:id', requireAuth, async (req, res) => {
  const id = Number.parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }

  const project = await defaultPrisma.project.findUnique({
    where: { id },
    include: PROJECT_DETAIL_INCLUDE,
  });
  if (!project) {
    res.status(404).json({ error: `No project with id ${id}` });
    return;
  }

  res.status(200).json(project);
});

projectsRouter.post('/projects', requireAuth, async (req, res) => {
  const userId = (req.user as any).id;
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  if (!title) {
    res.status(400).json({ error: 'title is required' });
    return;
  }

  const parentProjectId = req.body?.parentProjectId;
  if (parentProjectId !== undefined && !Number.isInteger(parentProjectId)) {
    res.status(400).json({ error: 'parentProjectId must be an integer' });
    return;
  }

  const sourceAssetId = req.body?.sourceAssetId;
  if (sourceAssetId !== undefined && !Number.isInteger(sourceAssetId)) {
    res.status(400).json({ error: 'sourceAssetId must be an integer' });
    return;
  }

  let created;
  try {
    created = await createProject({
      title,
      ownerUserId: userId,
      parentProjectId,
      detailsHeader: req.body?.detailsHeader,
    });
  } catch (err) {
    res.status(statusForToolError(err)).json({ error: toolErrorMessage(err) });
    return;
  }

  if (sourceAssetId !== undefined) {
    // SUC-011's "Library-asset-to-project flow" -- one round trip creates
    // the project *and* pre-populates its reference strip with the
    // clicked asset, rather than requiring the client to make a second
    // `POST /projects/:id/references` call. `'style'` is the default role
    // (per `Reference.role`'s documented values) since SUC-011's flow
    // never collects a role from the user -- an explicit `sourceAssetRole`
    // in the body overrides it.
    const role = typeof req.body?.sourceAssetRole === 'string' ? req.body.sourceAssetRole : 'style';
    try {
      await addReference({ projectId: created.id, assetId: sourceAssetId, role });
    } catch (err) {
      res.status(statusForToolError(err)).json({ error: toolErrorMessage(err) });
      return;
    }
  }

  const full = await defaultPrisma.project.findUnique({
    where: { id: created.id },
    include: PROJECT_DETAIL_INCLUDE,
  });

  res.status(201).json(full);
});

projectsRouter.post('/projects/:id/references', requireAuth, async (req, res) => {
  const projectId = Number.parseInt(String(req.params.id), 10);
  if (Number.isNaN(projectId)) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }

  const assetId = req.body?.assetId;
  if (!Number.isInteger(assetId)) {
    res.status(400).json({ error: 'assetId is required' });
    return;
  }
  const role = typeof req.body?.role === 'string' ? req.body.role.trim() : '';
  if (!role) {
    res.status(400).json({ error: 'role is required' });
    return;
  }

  let reference;
  try {
    reference = await addReference({ projectId, assetId, role });
  } catch (err) {
    res.status(statusForToolError(err)).json({ error: toolErrorMessage(err) });
    return;
  }

  res.status(201).json(reference);
});

projectsRouter.delete('/projects/:id/references/:refId', requireAuth, async (req, res) => {
  const projectId = Number.parseInt(String(req.params.id), 10);
  const refId = Number.parseInt(String(req.params.refId), 10);
  if (Number.isNaN(projectId) || Number.isNaN(refId)) {
    res.status(400).json({ error: 'Invalid project or reference id' });
    return;
  }

  // Confirms the reference actually belongs to the project named in the
  // URL before delegating the delete to `remove_reference` (which only
  // takes `referenceId`) -- a read, not a write, so this doesn't run afoul
  // of R1 (mirrors `postcards.ts`'s existing-project reads before it
  // delegates its own writes).
  const existing = await defaultPrisma.reference.findUnique({ where: { id: refId } });
  if (!existing || existing.projectId !== projectId) {
    res.status(404).json({ error: `No reference with id ${refId} for project ${projectId}` });
    return;
  }

  let result;
  try {
    result = await removeReference({ referenceId: refId });
  } catch (err) {
    res.status(statusForToolError(err)).json({ error: toolErrorMessage(err) });
    return;
  }

  res.status(200).json(result);
});

projectsRouter.patch('/projects/:id/iterations/:iterId', requireAuth, async (req, res) => {
  const projectId = Number.parseInt(String(req.params.id), 10);
  const iterId = Number.parseInt(String(req.params.iterId), 10);
  if (Number.isNaN(projectId) || Number.isNaN(iterId)) {
    res.status(400).json({ error: 'Invalid project or iteration id' });
    return;
  }

  const body = req.body ?? {};
  if (body.accepted === undefined && body.role === undefined) {
    res.status(400).json({ error: 'accepted or role is required' });
    return;
  }
  if (body.accepted !== undefined && typeof body.accepted !== 'boolean') {
    res.status(400).json({ error: 'accepted must be a boolean' });
    return;
  }
  if (body.role !== undefined && body.role !== null && body.role !== 'front' && body.role !== 'back') {
    res.status(400).json({ error: "role must be 'front', 'back', or null" });
    return;
  }

  // Same project-membership confirmation as the references DELETE above --
  // a read, not a write.
  const existing = await defaultPrisma.iteration.findUnique({ where: { id: iterId } });
  if (!existing || existing.projectId !== projectId) {
    res.status(404).json({ error: `No iteration with id ${iterId} for project ${projectId}` });
    return;
  }

  let updated;
  try {
    updated = await setIterationState({ iterationId: iterId, accepted: body.accepted, role: body.role });
  } catch (err) {
    res.status(statusForToolError(err)).json({ error: toolErrorMessage(err) });
    return;
  }

  res.status(200).json(updated);
});

/** OOP follow-up (2026-07-15): `OutputPane.tsx`'s per-row Delete control,
 * gated behind a client-side confirmation popup before this ever fires.
 * Same project-membership confirmation as the PATCH handler above, then
 * delegates to `remove_iteration` (R1) -- not a raw Prisma delete. */
projectsRouter.delete('/projects/:id/iterations/:iterId', requireAuth, async (req, res) => {
  const projectId = Number.parseInt(String(req.params.id), 10);
  const iterId = Number.parseInt(String(req.params.iterId), 10);
  if (Number.isNaN(projectId) || Number.isNaN(iterId)) {
    res.status(400).json({ error: 'Invalid project or iteration id' });
    return;
  }

  const existing = await defaultPrisma.iteration.findUnique({ where: { id: iterId } });
  if (!existing || existing.projectId !== projectId) {
    res.status(404).json({ error: `No iteration with id ${iterId} for project ${projectId}` });
    return;
  }

  let result;
  try {
    result = await removeIteration({ iterationId: iterId });
  } catch (err) {
    res.status(statusForToolError(err)).json({ error: toolErrorMessage(err) });
    return;
  }

  res.status(200).json(result);
});

/** OOP follow-up (2026-07-15): `ProjectList.tsx`'s bulk-select action bar --
 * archive (My/All views) and restore (Archive view) are the same PATCH,
 * differing only in the `status` value the client sends. Delegates to
 * `create_project`'s update path (its `id`+`version` optimistic-lock branch
 * already supports a bare `status` change) rather than a new tool function --
 * no other project fields are involved here. Reads the current row first (a
 * read, not a write, matching every other existing-row check in this file)
 * both to 404 on a missing project and to supply the `version`
 * `create_project`'s update path requires; a concurrent update losing that
 * race surfaces as `create_project`'s own `VersionConflictError` (409), not
 * a special case here. */
projectsRouter.patch('/projects/:id', requireAuth, async (req, res) => {
  const id = Number.parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }

  const status = req.body?.status;
  if (status !== 'active' && status !== 'archived') {
    res.status(400).json({ error: "status must be 'active' or 'archived'" });
    return;
  }

  const existing = await defaultPrisma.project.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: `No project with id ${id}` });
    return;
  }

  let updated;
  try {
    updated = await createProject({ id, version: existing.version, status });
  } catch (err) {
    res.status(statusForToolError(err)).json({ error: toolErrorMessage(err) });
    return;
  }

  res.status(200).json(updated);
});

/** OOP follow-up (2026-07-15): `ProjectList.tsx`'s bulk-select action bar's
 * Delete action, gated behind a client-side confirmation popup before this
 * ever fires. Delegates to `remove_project` (R1), which deletes the
 * `Project` row's dependent `ChatMessage`/`Reference`/`Iteration` rows
 * first, then the `Project` row itself, then best-effort removes the
 * project's workspace directory. */
projectsRouter.delete('/projects/:id', requireAuth, async (req, res) => {
  const id = Number.parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }

  const existing = await defaultPrisma.project.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: `No project with id ${id}` });
    return;
  }

  let result;
  try {
    result = await removeProject({ projectId: id });
  } catch (err) {
    res.status(statusForToolError(err)).json({ error: toolErrorMessage(err) });
    return;
  }

  res.status(200).json(result);
});
