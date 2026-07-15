import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fileUrl, type IterationDTO } from './types';

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

export default function OutputPane({ projectId, projectTitle, iterations, onIterationsChange }: OutputPaneProps) {
  const [patchError, setPatchError] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');

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

  /** PDF button (round trip, no separate text-editor visit required):
   * PUTs a content JSON built from whichever iterations currently hold
   * `role: 'front'`/`'back'` (`postcards.ts`'s content-JSON shape,
   * ticket 005), then POSTs `.../pdf` to render+stream it back
   * (`postcardPdf.ts`, ticket 006), opening the result in a new tab --
   * the wireframe's "PDF button... pops it up in a viewer window"
   * behavior, now against real image paths instead of a print stub. */
  async function handleGeneratePdf() {
    if (!hasMarkedSide || pdfBusy) return;
    setPdfBusy(true);
    setPdfError('');
    try {
      const content: Record<string, string> = {};
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
          {orderedIterations.map((iteration) => (
            <div
              key={iteration.id}
              data-testid={`iteration-row-${iteration.id}`}
              className="mx-auto w-full max-w-[800px] rounded border border-slate-200 bg-slate-100"
            >
              {/* Media fits within 800x800, aspect ratio preserved,
                  centered within the row. */}
              <div className="relative flex items-center justify-center overflow-hidden">
                <img
                  src={fileUrl(iteration.imagePath)}
                  alt={`Iteration ${iteration.seq}`}
                  className="mx-auto block h-auto max-h-[800px] w-auto max-w-[800px] object-contain"
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
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
