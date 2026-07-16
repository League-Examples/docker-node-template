import path from 'path';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { resolveWorkspacePath } from '../services/workspaceDirectorySync';

/**
 * Workspace file-serving route (architecture-update.md Step 1-2 gap
 * analysis, Design Rationale **R7**; ticket 004).
 *
 * `Asset.path`, `Iteration.imagePath`, and `postcard-content.json`'s
 * `front_image`/`back_image` are all workspace-relative paths -- before
 * this route existed, nothing served those bytes to a browser at all
 * (`app.ts` only mounted `express.static` for the built SPA). Every
 * image surface in the promoted UI (drawer thumbnails, iteration
 * gallery, postcard preview, project hero images) depends on this one,
 * generic, `requireAuth`-gated reader rather than a per-resource
 * endpoint -- see R7 for why a resource-scoped route or a second
 * `express.static` mount were both rejected.
 *
 * Path resolution and traversal-prevention are **not** reimplemented
 * here: `resolveWorkspacePath` (`services/workspaceDirectorySync.ts`) is
 * the same containment helper every other filesystem-touching module in
 * this codebase already reuses (`fsTools.ts`, `catalogTools.ts`,
 * `postcardPdf.ts`, `description.ts`, `postcards.ts`). Containment is
 * checked *before* any I/O -- a traversal attempt never reaches
 * `fs.stat`/`fs.createReadStream`.
 *
 * Read-only, unmoderated (D9 -- reads bypass the Workspace MCP Server by
 * design). Gate is `requireAuth` only, matching architecture-001's
 * shared-trust model and the gate every other new route in this sprint
 * uses (no `requireAdmin`).
 */
export const filesRouter = Router();

/** Mirrors `catalogTools.ts`'s `mimeTypeForAssetPath` lookup table, with
 * a few extra extensions this route also needs to serve (workspace
 * outputs include `.json`/`.html`/`.pdf`, not just asset images).
 * Falls back to a generic binary type for anything unrecognized rather
 * than guessing wrong. */
const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.html': 'text/html',
  '.txt': 'text/plain',
};

function mimeTypeForPath(filePath: string): string {
  return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

filesRouter.get('/files/*', requireAuth, async (req, res, next) => {
  const relativePath = req.params[0] ?? '';

  let resolved: string;
  try {
    resolved = resolveWorkspacePath(relativePath);
  } catch {
    // Path escapes the workspace root -- resolveWorkspacePath threw
    // before any I/O happened.
    res.status(400).json({ error: 'Invalid file path' });
    return;
  }

  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  if (!stat.isFile()) {
    // Directories (or anything else fs.stat resolves that isn't a
    // regular file) are treated as "not found" -- never expose a
    // directory listing.
    res.status(404).json({ error: 'File not found' });
    return;
  }

  res.set('Content-Type', mimeTypeForPath(resolved));
  res.set('Content-Length', String(stat.size));

  const stream = createReadStream(resolved);
  stream.on('error', next);
  stream.pipe(res);
});
