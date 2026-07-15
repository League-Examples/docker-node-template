import { Router, type Response } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requireAdmin } from '../middleware/requireAdmin';
import { runTurn, type TurnEvent } from '../agent/turn';

/**
 * Agent Runtime SSE chat API (architecture-update.md Step 3's Agent
 * Runtime bullet; ticket 005 AC6). Starts/continues a turn for a project
 * and streams the turn controller's step-by-step `TurnEvent`s
 * (`turn.ts`) as Server-Sent Events.
 *
 * **Auth gate chosen: `requireAuth` + `requireAdmin`.** No production
 * chat UI consumes this route yet -- per sprint.md's explicit Out of
 * Scope, Sprint 005 wires `MockupChatPanel.tsx` to it. `requireAdmin` was
 * chosen over a dedicated test-harness-only flag because it reuses
 * existing, already-tested middleware (`middleware/requireAdmin.ts`)
 * rather than adding a new env-gated code path solely for this temporary
 * scope boundary; Sprint 005 is expected to revisit this gate once the
 * real client UI wires in (a normal, authenticated project-owner user is
 * not necessarily an admin).
 */
export const chatRouter = Router();

function writeEvent(res: Response, event: TurnEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

chatRouter.post('/projects/:projectId/chat', requireAuth, requireAdmin, async (req, res) => {
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

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  try {
    await runTurn(
      { projectId, message },
      { onEvent: (event) => writeEvent(res, event) }
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
