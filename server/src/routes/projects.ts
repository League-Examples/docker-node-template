import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { prisma as defaultPrisma } from '../services/prisma';
import { createProject, addReference, removeReference, setIterationState, VersionConflictError } from '../agent-mcp/catalogTools';
import { LockConflictError } from '../agent-mcp/locks';

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

const PROJECT_DETAIL_INCLUDE = {
  iterations: { orderBy: { seq: 'asc' as const } },
  references: { orderBy: { id: 'asc' as const } },
  chatMessages: { orderBy: { createdAt: 'asc' as const } },
};

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
  });

  res.status(200).json({ projects });
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
