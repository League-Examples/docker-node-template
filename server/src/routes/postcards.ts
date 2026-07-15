import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requireAdmin } from '../middleware/requireAdmin';
import { prisma as defaultPrisma } from '../services/prisma';
import { createAgentPage } from '../agent-mcp/catalogTools';
import {
  parsePostcardContent,
  resolvePostcardImages,
  renderPostcardHtml,
  PostcardValidationError,
} from '../services/postcardRender';

/**
 * Postcard Render & PDF Service's HTTP surface, first half
 * (architecture-update.md Step 3, addendum eleventh module; ticket 005).
 * A single `PUT /api/postcards/:projectId` folds this ticket's three-step
 * flow into one handler (the ticket's "implementer's call" -- a separate
 * `GET .../html` step would only re-read the content JSON this handler
 * already has validated in memory, an unnecessary round trip):
 *
 *  1. Validate the request body against the content-JSON shape
 *     (`postcardRender.ts`'s `parsePostcardContent`) and confirm its
 *     `front_image`/`back_image` each match an existing
 *     `Iteration.imagePath` for the project (`resolvePostcardImages`) --
 *     both are pure/read-only, so a bad request never reaches a write.
 *  2. Persist the validated content as `postcard-content.json` via the
 *     **existing** `create_agent_page` Workspace MCP Server tool (Sprint
 *     003, called in-process, unmodified) -- keeps the write on the one
 *     moderated path (D9) even though this route isn't agent-loop-
 *     triggered.
 *  3. Render `postcard.html` from that same validated content
 *     (`renderPostcardHtml`) and persist it the same way.
 *
 * `create_agent_page` overwrites the file at its path on each call, so
 * re-submitting for the same project naturally replaces the previous
 * `postcard-content.json`/`postcard.html` while still recording a fresh
 * `Iteration` provenance row each time (that tool's existing, unmodified
 * behavior) -- no extra bookkeeping needed here.
 *
 * **Auth gate chosen: `requireAuth` + `requireAdmin`**, matching
 * `routes/chat.ts` (ticket 005 AC6 there; this ticket's AC7). No client UI
 * consumes this route yet -- Sprint 005 wires one in, and is expected to
 * revisit this gate once it does (a normal, authenticated project-owner
 * user is not necessarily an admin).
 */
export const postcardsRouter = Router();

postcardsRouter.put('/postcards/:projectId', requireAuth, requireAdmin, async (req, res) => {
  const projectId = Number.parseInt(String(req.params.projectId), 10);
  if (Number.isNaN(projectId)) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }

  let content;
  try {
    content = parsePostcardContent(req.body);
  } catch (err) {
    if (err instanceof PostcardValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  const project = await defaultPrisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    res.status(404).json({ error: `No project with id ${projectId}` });
    return;
  }

  try {
    await resolvePostcardImages(content, projectId, defaultPrisma);
  } catch (err) {
    if (err instanceof PostcardValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  const html = renderPostcardHtml(content);

  const contentResult = await createAgentPage({
    projectId,
    filename: 'postcard-content.json',
    content: JSON.stringify(content, null, 2),
    contentType: 'application/json',
  });
  const htmlResult = await createAgentPage({
    projectId,
    filename: 'postcard.html',
    content: html,
    contentType: 'text/html',
  });

  res.status(200).json({
    contentPath: contentResult.path,
    htmlPath: htmlResult.path,
    html,
  });
});
