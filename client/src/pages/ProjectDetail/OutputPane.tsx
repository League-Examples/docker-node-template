import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fileUrl, type IterationDTO, type PostcardContentDTO, type PostcardContentRegionDTO, type PostcardQr } from './types';
import PostcardOverlay from './PostcardOverlay';

/**
 * Top portion of the right pane: the project-output view (promoted from
 * `pages/mockups/MockupOutputPane.tsx`, ticket 005-009). Iterations stack
 * VERTICALLY, one per row (stakeholder round 1: "not back and forth, not
 * doubled up"), media capped at 800x800 and centered (round 9), real
 * images via `GET /api/files/*` (ticket 004) -- no `STUB_OUTPUT_ITERATIONS`.
 *
 * **Accepted / Front-Back exclusivity (stakeholder rounds 6-7)**: both
 * controls PATCH `/api/projects/:id/iterations/:iterId` (ticket 006 ->
 * `set_iteration_state`), which enforces exclusivity server-side inside
 * one transaction. This component never computes exclusivity itself for
 * persistence -- `applyIterationPatch` below only mirrors the same rule
 * against local state so the UI reflects the new state immediately, ahead
 * of a page reload (which re-fetches from the server and would show the
 * identical result regardless).
 *
 * **Delete an iteration, with a confirmation popup (OOP change,
 * 2026-07-15)**: each row's control bar carries a Delete button. Clicking
 * it does not delete immediately -- it shows an inline confirmation popup
 * over the row ("Delete this iteration?" with Delete / Cancel), matching
 * the ticket's explicit request for a confirmation step before an
 * irreversible action. Only one row's popup is open at a time
 * (`confirmDeleteId`). Confirming calls `DELETE
 * /api/projects/:id/iterations/:iterId` (`routes/projects.ts`'s new route,
 * -> `remove_iteration`) and, on success, removes the row from local state
 * via the same parent-owned `onIterationsChange` callback every other
 * mutation in this file already uses -- no separate re-fetch. Deleting a
 * front/back-role iteration is not specially guarded: `frontIteration`/
 * `backIteration` below are recomputed from whatever `iterations` remains
 * after the delete, so the PDF button's disabled-until-marked gate and the
 * gallery's overlay routing both naturally fall back to "no side marked"
 * rather than throwing or pointing at a deleted row.
 *
 * **Rendered-text overlay on the gallery (OOP change, 2026-07-15)**: a
 * `GET /api/postcards/:projectId` call on mount (mirrors
 * `PostcardEdit.tsx`'s own load-on-mount fetch) reads back whatever
 * postcard content was last saved for this project. The iteration
 * currently holding `role: 'front'` gets `content.front_regions`/
 * `front_qr` overlaid on its image; the `role: 'back'` iteration gets
 * `back_regions`/`back_qr`; every other iteration (no role, or a role but
 * no saved content) renders bare, exactly as before. `IterationImage`
 * below measures each iteration's actual rendered `<img>` pixel width (the
 * gallery caps images at 800x800, aspect preserved, so the on-screen size
 * varies by artwork) and hands that to `PostcardOverlay`, which scales the
 * inch-based region/QR positions to match. Both of "nothing saved yet"
 * (`{ content: null }`) and any fetch/parse error leave the gallery at its
 * bare-image default -- neither is surfaced as an error, same swallow
 * pattern as `PostcardEdit.tsx`'s own hydration effect. The overlay is
 * strictly read-only (no move handles, no label tags, no click-to-edit) --
 * see `PostcardOverlay.tsx`'s own header.
 */

type IterationRole = 'none' | 'front' | 'back';

interface OutputPaneProps {
  projectId: number;
  projectTitle: string;
  iterations: IterationDTO[];
  onIterationsChange: (next: IterationDTO[]) => void;
}

function roleOf(iteration: IterationDTO): IterationRole {
  return iteration.role ?? 'none';
}

/** Mirrors `catalogTools.ts`'s `set_iteration_state` exclusivity rule
 * against the in-memory iteration list: the server already enforced this
 * for the just-PATCHed `updated` row (and whichever other row it cleared)
 * -- this just keeps every *other* iteration already in local state
 * consistent with that same round trip's result. */
export function applyIterationPatch(iterations: IterationDTO[], updated: IterationDTO): IterationDTO[] {
  return iterations.map((iteration) => {
    if (iteration.id === updated.id) return updated;
    let next = iteration;
    if (updated.accepted && next.accepted) {
      next = { ...next, accepted: false };
    }
    if (updated.role !== null && next.role === updated.role) {
      next = { ...next, role: null };
    }
    return next;
  });
}

async function patchIteration(
  projectId: number,
  iterationId: number,
  body: { accepted?: boolean; role?: 'front' | 'back' | null },
): Promise<IterationDTO> {
  const res = await fetch(`/api/projects/${projectId}/iterations/${iterationId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function deleteIteration(projectId: number, iterationId: number): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/iterations/${iterationId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export default function OutputPane({ projectId, projectTitle, iterations, onIterationsChange }: OutputPaneProps) {
  const [patchError, setPatchError] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');

  // Iteration-delete confirmation popup (see module header): at most one
  // row's popup is open at a time, keyed by that iteration's id.
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState('');

  // Rendered-text overlay source (see module header). `null` covers both
  // "nothing saved yet" and a transient fetch/parse error -- either way the
  // gallery just shows bare images, same as before this OOP change.
  const [postcardContent, setPostcardContent] = useState<PostcardContentDTO | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/postcards/${projectId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { content: PostcardContentDTO | null };
        if (!cancelled) setPostcardContent(data?.content ?? null);
      } catch {
        if (!cancelled) setPostcardContent(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const frontIteration = iterations.find((iteration) => iteration.role === 'front');
  const backIteration = iterations.find((iteration) => iteration.role === 'back');
  const hasMarkedSide = Boolean(frontIteration || backIteration);

  // Display most-recent iteration first (highest seq at the top). The API
  // returns iterations in `seq asc`; the gallery shows them newest-first
  // per stakeholder review (post-004 OOP correction).
  const orderedIterations = [...iterations].sort((a, b) => b.seq - a.seq);

  async function handleAcceptedChange(iteration: IterationDTO, checked: boolean) {
    setPatchError('');
    try {
      const updated = await patchIteration(projectId, iteration.id, { accepted: checked });
      onIterationsChange(applyIterationPatch(iterations, updated));
    } catch {
      setPatchError('Failed to update accepted state -- please try again.');
    }
  }

  async function handleRoleChange(iteration: IterationDTO, role: IterationRole) {
    setPatchError('');
    try {
      const updated = await patchIteration(projectId, iteration.id, { role: role === 'none' ? null : role });
      onIterationsChange(applyIterationPatch(iterations, updated));
    } catch {
      setPatchError('Failed to update side -- please try again.');
    }
  }

  async function handleDeleteConfirmed(iteration: IterationDTO) {
    setDeleteError('');
    try {
      await deleteIteration(projectId, iteration.id);
      onIterationsChange(iterations.filter((existing) => existing.id !== iteration.id));
    } catch {
      setDeleteError('Failed to delete iteration -- please try again.');
    } finally {
      setConfirmDeleteId(null);
    }
  }

  /** PDF button (round trip, no separate text-editor visit required):
   * PUTs a content JSON built from whichever iterations currently hold
   * `role: 'front'`/`'back'` (`postcards.ts`'s content-JSON shape,
   * ticket 005), then POSTs `.../pdf` to render+stream it back
   * (`postcardPdf.ts`, ticket 006), opening the result in a new tab --
   * the wireframe's "PDF button... pops it up in a viewer window"
   * behavior, now against real image paths instead of a print stub.
   *
   * **Merge, never clobber (OOP data-loss fix, 2026-07-16)**: `PUT
   * /api/postcards/:id` REPLACES the saved content wholesale
   * (`postcards.ts`'s own doc comment -- `create_agent_page` overwrites
   * the file in place). Sending only `{ front_image, back_image }` here
   * used to WIPE any `front_regions`/`back_regions`/`front_qr`/`back_qr`
   * a stakeholder had already saved via the text editor
   * (`PostcardEdit.tsx`) -- confirmed data loss on a real project. This
   * button only ever changes which images are on the postcard, so it
   * must carry forward whatever regions/QR already exist: a fresh `GET
   * /api/postcards/:id` immediately before the PUT (not the mount-time
   * `postcardContent` state, which can be stale if content was saved
   * elsewhere since this page loaded) supplies `front_regions`/
   * `back_regions`/`front_qr`/`back_qr` verbatim, and only
   * `front_image`/`back_image` are overwritten from the current
   * front/back-role iterations. When nothing has been saved yet
   * (`{ content: null }`), there is nothing to lose, so an images-only
   * payload is correct. */
  async function handleGeneratePdf() {
    if (!hasMarkedSide || pdfBusy) return;
    setPdfBusy(true);
    setPdfError('');
    try {
      let existing: PostcardContentDTO | null = null;
      try {
        const existingRes = await fetch(`/api/postcards/${projectId}`);
        if (existingRes.ok) {
          const data = (await existingRes.json()) as { content: PostcardContentDTO | null };
          existing = data?.content ?? null;
        }
      } catch {
        // Fetch failed -- fall through with existing = null. The PUT
        // below then carries only the image paths, same as if nothing
        // had been saved yet; it never sends an explicit empty-regions
        // payload that would overwrite real, unread content.
      }

      const content: Record<string, unknown> = {};
      if (existing?.front_regions) content.front_regions = existing.front_regions;
      if (existing?.back_regions) content.back_regions = existing.back_regions;
      if (existing?.front_qr) content.front_qr = existing.front_qr;
      if (existing?.back_qr) content.back_qr = existing.back_qr;
      if (frontIteration) content.front_image = frontIteration.imagePath;
      if (backIteration) content.back_image = backIteration.imagePath;

      const putRes = await fetch(`/api/postcards/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(content),
      });
      if (!putRes.ok) throw new Error(`HTTP ${putRes.status}`);

      const pdfRes = await fetch(`/api/postcards/${projectId}/pdf`, { method: 'POST' });
      if (!pdfRes.ok) throw new Error(`HTTP ${pdfRes.status}`);

      const blob = await pdfRes.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch {
      setPdfError('Failed to generate the PDF -- please try again.');
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <section className="flex-[3] min-h-0 overflow-y-auto border-b border-slate-200 p-4">
      <header className="mb-4 flex items-start gap-4">
        <Link
          to="/"
          aria-label="Back to projects"
          className="rounded border border-slate-300 px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-50"
        >
          ←
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-slate-800">{projectTitle}</h1>
          {patchError && <p className="mt-1 text-xs text-red-600">{patchError}</p>}
          {deleteError && <p className="mt-1 text-xs text-red-600">{deleteError}</p>}
        </div>
        <div className="ml-auto flex flex-shrink-0 items-center gap-2">
          {pdfError && <span className="text-xs text-red-600">{pdfError}</span>}
          <button
            type="button"
            disabled={!hasMarkedSide || pdfBusy}
            onClick={() => void handleGeneratePdf()}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {pdfBusy ? 'Generating…' : 'PDF'}
          </button>
          <Link
            to={`/projects/${projectId}/postcard`}
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Text Entry
          </Link>
        </div>
      </header>

      {iterations.length === 0 ? (
        <p className="text-sm text-slate-400">No iterations yet.</p>
      ) : (
        // Iterations stack vertically, one per row -- not side by side
        // (round 1's "not back and forth, not doubled up" regression).
        <div className="flex flex-col gap-4">
          {orderedIterations.map((iteration) => {
            // The rendered-text overlay is keyed off THIS iteration's own
            // role (see module header) -- an iteration with no role, or a
            // role but no saved content for that face, renders bare.
            const role = roleOf(iteration);
            const overlayRegions =
              role === 'front' ? postcardContent?.front_regions : role === 'back' ? postcardContent?.back_regions : undefined;
            const overlayQr = role === 'front' ? postcardContent?.front_qr : role === 'back' ? postcardContent?.back_qr : undefined;
            return (
              <div
                key={iteration.id}
                data-testid={`iteration-row-${iteration.id}`}
                className="relative mx-auto w-full max-w-[800px] rounded border border-slate-200 bg-slate-100"
              >
                {/* Media fits within 800x800, aspect ratio preserved,
                    centered within the row. */}
                <div className="relative flex items-center justify-center overflow-hidden">
                  <IterationImage
                    src={fileUrl(iteration.imagePath)}
                    alt={`Iteration ${iteration.seq}`}
                    overlayRegions={overlayRegions}
                    overlayQr={overlayQr}
                  />
                  <div className="absolute left-2 top-2 flex items-center gap-2">
                    <span className="rounded bg-white/85 px-2 py-0.5 text-sm text-slate-700">
                      Iteration {iteration.seq}
                    </span>
                    {roleOf(iteration) !== 'none' && (
                      <span
                        data-testid={`role-badge-${iteration.id}`}
                        className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold uppercase text-amber-700"
                      >
                        {roleOf(iteration)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 border-t border-slate-200 bg-white px-3 py-2 text-sm">
                  <label className="flex items-center gap-1.5 text-slate-600">
                    <input
                      type="checkbox"
                      aria-label={`Iteration ${iteration.seq} accepted`}
                      checked={iteration.accepted}
                      onChange={(event) => void handleAcceptedChange(iteration, event.target.checked)}
                    />
                    Accepted
                  </label>
                  <label className="ml-auto flex items-center gap-1.5 text-slate-600">
                    Side
                    <select
                      aria-label={`Iteration ${iteration.seq} side`}
                      value={roleOf(iteration)}
                      onChange={(event) => void handleRoleChange(iteration, event.target.value as IterationRole)}
                      className="rounded border border-slate-300 px-2 py-1 text-sm"
                    >
                      <option value="none">—</option>
                      <option value="front">Front</option>
                      <option value="back">Back</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    aria-label={`Delete iteration ${iteration.seq}`}
                    onClick={() => setConfirmDeleteId(iteration.id)}
                    className="rounded border border-red-300 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
                {confirmDeleteId === iteration.id && (
                  <div
                    data-testid={`delete-confirm-${iteration.id}`}
                    className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900/40"
                  >
                    <div className="rounded border border-slate-300 bg-white p-4 text-center shadow-lg">
                      <p className="mb-3 text-sm font-medium text-slate-700">Delete this iteration?</p>
                      <div className="flex justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleDeleteConfirmed(iteration)}
                          className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

interface IterationImageProps {
  src: string;
  alt: string;
  overlayRegions?: PostcardContentRegionDTO[];
  overlayQr?: PostcardQr | null;
}

/** One iteration's image, plus (when this iteration's face has saved
 * postcard content) a `PostcardOverlay` scaled to match. Measures the
 * `<img>`'s own actual rendered pixel width via `getBoundingClientRect` --
 * both on load (the image has no intrinsic size before then) and via a
 * `ResizeObserver` (the gallery's `object-contain`/800px-cap sizing can
 * change with the viewport) -- so the overlay always lines up with
 * whatever size THIS artwork ends up displayed at, not a hardcoded
 * assumption. `widthPx` starts at 0 (no overlay rendered) until the first
 * successful measurement. */
function IterationImage({ src, alt, overlayRegions, overlayQr }: IterationImageProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [widthPx, setWidthPx] = useState(0);

  function measure() {
    const el = imgRef.current;
    if (el) setWidthPx(el.getBoundingClientRect().width);
  }

  useEffect(() => {
    measure();
    const el = imgRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => measure());
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const showOverlay = (overlayRegions && overlayRegions.length > 0) || !!overlayQr;

  return (
    <div className="relative inline-block">
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        onLoad={measure}
        className="mx-auto block h-auto max-h-[800px] w-auto max-w-[800px] object-contain"
      />
      {showOverlay && <PostcardOverlay regions={overlayRegions ?? []} qr={overlayQr} widthPx={widthPx} />}
    </div>
  );
}
