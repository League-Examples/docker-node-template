import fs from 'fs/promises';
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { prisma as defaultPrisma } from '../services/prisma';
import { createAgentPage } from '../agent-mcp/catalogTools';
import { resolveWorkspacePath } from '../services/workspaceDirectorySync';
import {
  parsePostcardContent,
  resolvePostcardImages,
  renderPostcardHtml,
  PostcardValidationError,
  type PostcardContent,
} from '../services/postcardRender';
import { renderPostcardPdf } from '../services/postcardPdf';

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
 *     003, called in-process) -- keeps the write on the one moderated path
 *     (D9) even though this route isn't agent-loop-triggered.
 *  3. Render `postcard.html` from that same validated content
 *     (`renderPostcardHtml`) and persist it the same way.
 *
 * `create_agent_page` overwrites the file at its path on each call, so
 * re-submitting for the same project naturally replaces the previous
 * `postcard-content.json`/`postcard.html` -- no extra bookkeeping needed
 * here.
 *
 * **`recordIteration: false` (OOP follow-up, 2026-07-15)**: all three
 * `create_agent_page` calls in this file (content JSON + HTML here, PDF
 * below) pass `recordIteration: false` -- these three files are pipeline
 * *outputs*, not gallery-worthy iterations, and recording an `Iteration`
 * row per autosave/PDF-generate call was polluting `OutputPane.tsx`'s
 * iteration gallery with broken-image rows pointing at an HTML/JSON/PDF
 * file instead of an image (`catalogTools.ts`'s `CreateAgentPageArgs` doc
 * comment has the full rationale). `routes/projects.ts`'s
 * `PROJECT_DETAIL_INCLUDE`/`PROJECT_LIST_INCLUDE` also filter out any
 * `agent-page:`-prefixed `Iteration` row defensively, in case an older
 * build's rows are still in the database.
 *
 * **Auth gate: `requireAuth` only** (ticket 006 -- `requireAdmin` dropped
 * from both routes below), matching `routes/chat.ts`. Sprint 005 now
 * wires a real client UI to both routes (SUC-008/SUC-009), the follow-up
 * this file's original gate anticipated: a normal, authenticated
 * project-owner user is not necessarily an admin.
 *
 * **`GET /api/postcards/:projectId`** (Sprint 005 OOP follow-up, 2026-07-15):
 * the read side of the PUT above, so the client editor (`PostcardEdit.tsx`)
 * can hydrate a previously-saved layout on mount instead of starting from
 * client-only state that vanished on reload. Reads back whatever
 * `postcard-content.json` the PUT handler most recently persisted, via the
 * exact same `resolveWorkspacePath` read the PDF route below already does.
 * Two distinguishable outcomes for the client: `200 { content: null }` when
 * nothing has been saved yet for this project (no prior PUT -- NOT a 404,
 * since the project itself is real and the client shouldn't treat "nothing
 * saved" as an error), and `200 { content: <PostcardContent> }` once
 * something has. A malformed/corrupted stored file (should not happen in
 * practice -- only this route's own PUT ever writes it) maps to 400 via
 * `parsePostcardContent`, mirroring the PDF route's re-parse below.
 *
 * **`POST /api/postcards/:projectId/pdf`** (ticket 006): the second half
 * of the pipeline. Reads back whatever `postcard-content.json` the PUT
 * handler above most recently persisted for this project (no request
 * body -- per sprint.md, "one PDF endpoint serves both the iterations-view
 * PDF button... and the text editor's 'Generate PDF' action", i.e. both
 * callers just want "the PDF for the project's current state", not a new
 * submission), re-derives per-face HTML via `renderPostcardHtml` (once
 * per present face, each called with only that face's image set so
 * `postcardPdf.ts` gets an isolated single-`.page` doc to rasterize), and
 * hands those to `renderPostcardPdf` (`postcardPdf.ts`: raster -> bleed
 * pad -> rotate -> assemble with `/TrimBox`/`/BleedBox` metadata). The
 * result is persisted as `postcard.pdf` via the same `create_agent_page`
 * path as the JSON/HTML above, *and* streamed back directly in the
 * response body (`Content-Type: application/pdf`) -- the wireframe's "PDF
 * button... pops it up in a viewer window" behavior.
 */
export const postcardsRouter = Router();

postcardsRouter.put('/postcards/:projectId', requireAuth, async (req, res) => {
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
    recordIteration: false,
  });
  const htmlResult = await createAgentPage({
    projectId,
    filename: 'postcard.html',
    content: html,
    contentType: 'text/html',
    recordIteration: false,
  });

  res.status(200).json({
    contentPath: contentResult.path,
    htmlPath: htmlResult.path,
    html,
  });
});

postcardsRouter.get('/postcards/:projectId', requireAuth, async (req, res) => {
  const projectId = Number.parseInt(String(req.params.projectId), 10);
  if (Number.isNaN(projectId)) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }

  const project = await defaultPrisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    res.status(404).json({ error: `No project with id ${projectId}` });
    return;
  }

  const contentPath = `projects/${projectId}/outputs/postcard-content.json`;
  let raw: string;
  try {
    raw = await fs.readFile(resolveWorkspacePath(contentPath), 'utf8');
  } catch {
    // Nothing saved yet -- not an error; the client leaves its editor state
    // at defaults on this outcome (see this file's module header).
    res.status(200).json({ content: null });
    return;
  }

  let content: PostcardContent;
  try {
    content = parsePostcardContent(JSON.parse(raw));
  } catch (err) {
    if (err instanceof PostcardValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  res.status(200).json({ content });
});

/** Renders `content` (already-validated) to a per-face, single-`.page`
 * HTML doc for `postcardPdf.ts` to rasterize -- `renderPostcardHtml`
 * itself is agnostic to which/how-many faces are present (R3: driven by
 * `front_image`/`back_image` presence), so isolating one face is just a
 * matter of calling it with the other face's image unset. */
function faceOnlyHtml(content: PostcardContent, side: 'front' | 'back'): string {
  if (side === 'front') {
    return renderPostcardHtml({ ...content, back_image: undefined });
  }
  return renderPostcardHtml({ ...content, front_image: undefined });
}

postcardsRouter.post('/postcards/:projectId/pdf', requireAuth, async (req, res) => {
  const projectId = Number.parseInt(String(req.params.projectId), 10);
  if (Number.isNaN(projectId)) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }

  const project = await defaultPrisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    res.status(404).json({ error: `No project with id ${projectId}` });
    return;
  }

  const contentPath = `projects/${projectId}/outputs/postcard-content.json`;
  let raw: string;
  try {
    raw = await fs.readFile(resolveWorkspacePath(contentPath), 'utf8');
  } catch {
    res.status(404).json({
      error: `No postcard-content.json submitted yet for project ${projectId} -- PUT /api/postcards/${projectId} first`,
    });
    return;
  }

  let content: PostcardContent;
  try {
    content = parsePostcardContent(JSON.parse(raw));
  } catch (err) {
    if (err instanceof PostcardValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  if (content.front_image === undefined) {
    // Per this ticket's description ("front always; back only if
    // back_image is set") a postcard PDF always has a front face -- a
    // persisted content JSON with only back_image (schema-legal for
    // postcardRender.ts's HTML preview, R3) has nothing for the PDF
    // pipeline's mandatory first page.
    res.status(400).json({ error: `Postcard PDF export requires front_image to be set for project ${projectId}` });
    return;
  }

  const frontHtml = faceOnlyHtml(content, 'front');
  const backHtml = content.back_image !== undefined ? faceOnlyHtml(content, 'back') : undefined;

  // Rasterization runs a headless browser (puppeteer-core); a launch/render
  // failure (e.g. no Chromium on the host) must surface as a 500, never an
  // unhandled rejection that crashes the whole server process.
  let pdfBytes: Buffer;
  let pdfResult;
  try {
    pdfBytes = await renderPostcardPdf({ front: frontHtml, back: backHtml });
    pdfResult = await createAgentPage({
      projectId,
      filename: 'postcard.pdf',
      content: pdfBytes,
      contentType: 'application/pdf',
      recordIteration: false,
    });
  } catch (err) {
    console.error(`Postcard PDF generation failed for project ${projectId}:`, err);
    res.status(500).json({ error: 'Failed to generate postcard PDF.' });
    return;
  }

  res.status(200);
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `inline; filename="postcard.pdf"`);
  res.set('X-Postcard-Pdf-Path', pdfResult.path);
  res.send(pdfBytes);
});
