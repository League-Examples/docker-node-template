import { Router, type Response } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { runTurn, type TurnEvent } from '../agent/turn';
import { createRealImageVisionClient } from '../agent/realImageVisionClient';

/**
 * Agent Runtime SSE chat API (architecture-update.md Step 3's Agent
 * Runtime bullet; ticket 005 AC6). Starts/continues a turn for a project
 * and streams the turn controller's step-by-step `TurnEvent`s
 * (`turn.ts`) as Server-Sent Events.
 *
 * **Auth gate: `requireAuth` only** (ticket 006 -- `requireAdmin` dropped).
 * Sprint 005 now wires `MockupChatPanel.tsx` to this route (SUC-005), the
 * "real client UI" this file's original gate anticipated: a normal,
 * authenticated project-owner user is not necessarily an admin, so
 * `requireAdmin` would have blocked exactly the caller this route exists
 * for.
 */
export const chatRouter = Router();

/** The real, `imaging.ts`-backed `ImageVisionClient` (ticket 004-002) --
 * built once at module load (it only closes over the shared app Prisma/
 * Versioning singletons; no API key is read and no network call is made
 * until a `generate_image` tool call actually invokes it), passed to
 * every `runTurn` call below instead of relying on `turn.ts`'s stub
 * default. */
const imageVisionClient = createRealImageVisionClient();

function writeEvent(res: Response, event: TurnEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

chatRouter.post('/projects/:projectId/chat', requireAuth, async (req, res) => {
  const projectId = Number.parseInt(String(req.params.projectId), 10);
  if (Number.isNaN(projectId)) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }

  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  // Sprint 005 OOP change, 2026-07-15: which stream tab was active in the
  // client when this message was sent -- threaded through to `runTurn` so
  // any `generate_image` call this turn dispatches tags its new Iteration
  // into that stream (see `turn.ts`'s `RunTurnInput.activeFace`). Any value
  // other than the two valid faces (missing, wrong type, typo) is treated
  // as "unspecified" rather than a 400 -- `runTurn` already defaults to
  // `'front'` in that case, and this field describes UI convenience, not a
  // validated business input worth rejecting a whole chat turn over.
  const activeFaceRaw = req.body?.activeFace;
  const activeFace = activeFaceRaw === 'front' || activeFaceRaw === 'back' ? activeFaceRaw : undefined;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  try {
    await runTurn(
      { projectId, message, activeFace },
      { onEvent: (event) => writeEvent(res, event), imageVisionClient }
    );
  } catch (err: any) {
    // `runTurn` already emits a `type: 'error'` event for any failure
    // (including TurnLockTimeoutError) before rethrowing -- nothing
    // further to write here, the stream just ends. Swallow rather than
    // `next(err)`: headers are already sent, Express's default error
    // handler cannot usefully respond to an SSE stream at this point.
  } finally {
    res.end();
  }
});
