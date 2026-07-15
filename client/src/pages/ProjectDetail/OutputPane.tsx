import { useRef, useState } from 'react';
import { fileUrl, type IterationDTO, type PostcardContentRegionDTO, type PostcardQr } from './types';
import PostcardOverlay from './PostcardOverlay';
import PostcardFaceEditor from './PostcardFaceEditor';
import { useMeasuredWidth } from '../../lib/useMeasuredWidth';
import { toContentRegion, type PostcardSide } from '../../lib/postcardFaceEditing';
import type { UsePostcardEditorStateResult } from './usePostcardEditorState';

/**
 * The scrolling iteration STREAM (Sprint 005 OOP change, 2026-07-15: two-
 * pane rebuild) -- promoted from `pages/mockups/MockupOutputPane.tsx`
 * (ticket 005-009), then rebuilt this sprint from "one gallery of every
 * iteration" into "one stream per face". This component is now purely the
 * scrolling middle region of the project view: the title/tabs/PDF button
 * that used to live in this file's own `<header>` moved UP into
 * `ProjectDetail/index.tsx`'s fixed top area (see that file's module
 * header for the full fixed-top/scroll-middle/fixed-bottom layout), and
 * the standalone `/projects/:id/postcard` text editor page is DELETED --
 * its editing machinery now renders INLINE here, on whichever iteration is
 * currently accepted in the active stream (see `PostcardFaceEditor.tsx`
 * and `usePostcardEditorState.ts`'s own module headers for that
 * extraction).
 *
 * **`role` is now stream membership, not a single front/back slot**: MANY
 * iterations can share `role: 'front'` (the whole front stream) or
 * `role: 'back'`. `iterations` arrives UNFILTERED from `index.tsx`; this
 * component filters to `role === activeTab` itself, newest-first (`seq`
 * desc, unchanged ordering rule) -- switching tabs is a pure client-side
 * filter, no re-fetch.
 *
 * **No more per-iteration side `<select>`**: every visible row already
 * shares `activeTab`'s role by construction (the filter above), so the
 * old pulldown -- and the role badge that showed it -- are both gone. The
 * only remaining per-row controls are the Accepted checkbox (still a
 * `PATCH .../iterations/:id`, now enforcing per-`(project, role)`
 * exclusivity server-side -- see `catalogTools.ts`'s `set_iteration_state`)
 * and the Delete button (unchanged).
 *
 * **Inline accepted-iteration editor**: the row whose `accepted` flag is
 * `true` (there is at most one per stream, enforced server-side) renders
 * `PostcardFaceEditor` instead of a bare image -- the same click-to-edit/
 * drag-to-draw/move-resize/QR machinery `PostcardEdit.tsx` used to own,
 * now scoped to exactly this one face. Every OTHER row in the stream still
 * renders read-only: bare image + `PostcardOverlay`, sourced from the SAME
 * `postcardEditor` state (regions are per-FACE, not per-image, so every
 * iteration in a stream previews the identical text -- accepting a
 * different iteration in the stream carries the same regions over to the
 * new image, per the stakeholder's explicit requirement).
 */

interface OutputPaneProps {
  projectId: number;
  iterations: IterationDTO[];
  activeTab: PostcardSide;
  onIterationsChange: (next: IterationDTO[]) => void;
  postcardEditor: UsePostcardEditorStateResult;
  /** Reserves space at the bottom of the scroll area so the floating chat
   * panel (`index.tsx`) never overlaps the last row -- see that file's
   * module header. */
  scrollPaddingBottomPx: number;
}

/** Mirrors `catalogTools.ts`'s `set_iteration_state` exclusivity rule
 * against the in-memory iteration list (Sprint 005 OOP change, 2026-07-15:
 * per-`(project, role)` now, not project-wide -- accepting a front-stream
 * iteration must never locally clear an already-accepted back-stream
 * iteration). Role itself is never mirrored here -- this sprint's model
 * removes the client's ability to PATCH `role` at all (no more side
 * pulldown), so there is no other row's role to keep consistent. */
export function applyIterationPatch(iterations: IterationDTO[], updated: IterationDTO): IterationDTO[] {
  return iterations.map((iteration) => {
    if (iteration.id === updated.id) return updated;
    if (updated.accepted && iteration.accepted && iteration.role === updated.role) {
      return { ...iteration, accepted: false };
    }
    return iteration;
  });
}

async function patchIteration(projectId: number, iterationId: number, body: { accepted?: boolean }): Promise<IterationDTO> {
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

export default function OutputPane({
  projectId,
  iterations,
  activeTab,
  onIterationsChange,
  postcardEditor,
  scrollPaddingBottomPx,
}: OutputPaneProps) {
  const [patchError, setPatchError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState('');

  // The active stream, newest-first (highest seq at the top) -- unchanged
  // ordering rule, now scoped to `activeTab`'s role.
  const streamIterations = iterations
    .filter((iteration) => iteration.role === activeTab)
    .sort((a, b) => b.seq - a.seq);

  // Regions/QR for the active face -- the SAME state `PostcardFaceEditor`
  // edits, converted to the read-only overlay's DTO shape for every
  // non-accepted row in the stream (see module header: text boxes are
  // per-face, so every iteration in a stream previews the same content).
  const overlayRegions: PostcardContentRegionDTO[] = postcardEditor.regionsBySide[activeTab].map((region) =>
    toContentRegion(region, postcardEditor.regionText),
  );
  const overlayQr: PostcardQr | null = postcardEditor.qrBySide[activeTab];

  async function handleAcceptedChange(iteration: IterationDTO, checked: boolean) {
    setPatchError('');
    try {
      const updated = await patchIteration(projectId, iteration.id, { accepted: checked });
      onIterationsChange(applyIterationPatch(iterations, updated));
    } catch {
      setPatchError('Failed to update accepted state -- please try again.');
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

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto p-4"
      style={{ paddingBottom: scrollPaddingBottomPx }}
      data-testid="iteration-stream"
    >
      {(patchError || deleteError) && (
        <div className="mx-auto mb-3 w-full max-w-[800px]">
          {patchError && <p className="text-xs text-red-600">{patchError}</p>}
          {deleteError && <p className="text-xs text-red-600">{deleteError}</p>}
        </div>
      )}

      {streamIterations.length === 0 ? (
        <p className="text-sm text-slate-400">No {activeTab} iterations yet.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {streamIterations.map((iteration) => (
            <div
              key={iteration.id}
              data-testid={`iteration-row-${iteration.id}`}
              className="relative mx-auto w-full max-w-[800px] rounded border border-slate-200 bg-slate-100"
            >
              <div className="relative flex items-center justify-center overflow-hidden p-4">
                {iteration.accepted ? (
                  <PostcardFaceEditor
                    side={activeTab}
                    imagePath={iteration.imagePath}
                    regions={postcardEditor.regionsBySide[activeTab]}
                    regionText={postcardEditor.regionText}
                    qr={postcardEditor.qrBySide[activeTab]}
                    existingRegionNames={postcardEditor.existingRegionNames}
                    onAddRegion={(region, text) => postcardEditor.addRegion(activeTab, region, text)}
                    onRegionTextChange={postcardEditor.setRegionText}
                    onRegionPositionChange={(name, position) => postcardEditor.setRegionPosition(activeTab, name, position)}
                    onDeleteRegion={(name) => postcardEditor.removeRegion(activeTab, name)}
                    onAddQr={() => postcardEditor.addQr(activeTab)}
                    onQrUrlChange={(url) => postcardEditor.setQrUrl(activeTab, url)}
                    onQrPositionChange={(position) => postcardEditor.setQrPosition(activeTab, position)}
                    onDeleteQr={() => postcardEditor.removeQr(activeTab)}
                  />
                ) : (
                  <IterationImage
                    src={fileUrl(iteration.imagePath)}
                    alt={`Iteration ${iteration.seq}`}
                    overlayRegions={overlayRegions}
                    overlayQr={overlayQr}
                  />
                )}
                <span className="absolute left-2 top-2 rounded bg-white/85 px-2 py-0.5 text-sm text-slate-700">
                  Iteration {iteration.seq}
                </span>
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
                <button
                  type="button"
                  aria-label={`Delete iteration ${iteration.seq}`}
                  onClick={() => setConfirmDeleteId(iteration.id)}
                  className="ml-auto rounded border border-red-300 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
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
          ))}
        </div>
      )}
    </div>
  );
}

interface IterationImageProps {
  src: string;
  alt: string;
  overlayRegions?: PostcardContentRegionDTO[];
  overlayQr?: PostcardQr | null;
}

/** One non-accepted iteration's read-only image + overlay (unchanged from
 * before this sprint's rebuild) -- media caps at 800x800, aspect
 * preserved, centered; `useMeasuredWidth` scales `PostcardOverlay` to the
 * `<img>`'s actual rendered pixel width. */
function IterationImage({ src, alt, overlayRegions, overlayQr }: IterationImageProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const { widthPx, measure } = useMeasuredWidth(imgRef, src);

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
