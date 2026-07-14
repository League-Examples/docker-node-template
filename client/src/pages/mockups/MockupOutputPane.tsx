import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  STUB_OUTPUT_ITERATIONS,
  STUB_PROJECT_META,
  STUB_PROJECT_NAME,
} from './mockupStubData';

type IterationRole = 'none' | 'front' | 'back';

/** Opens a print-formatted window showing one 6x4in page per marked
 * side (front first). "PDF view of the accepted pages": just the front
 * if only a front is marked; front and back if both are. */
function openSidesPdf(pages: { side: string; label: string }[]) {
  const w = window.open('', '_blank', 'width=700,height=550');
  if (!w) return;
  const pageDivs = pages
    .map(
      (p) =>
        `<div class="page"><p>${p.side.toUpperCase()} — ${p.label}</p></div>`,
    )
    .join('\n');
  w.document.write(`<!doctype html>
<html>
<head>
<title>Postcard PDF preview</title>
<style>
  @page { size: 6in 4in; margin: 0; }
  body { margin: 0; }
  .page {
    width: 6in; height: 4in; page-break-after: always; background: #eee;
    display: flex; align-items: center; justify-content: center;
    font-family: sans-serif; color: #666;
  }
</style>
</head>
<body>
${pageDivs}
<script>window.onload = function () { window.print(); };</script>
</body>
</html>`);
  w.document.close();
}

/**
 * Top portion of the right pane: the project-output view (spec §2, §6).
 * Iterations stack vertically, most recent last, never overwritten (spec
 * §6 grounding). Iteration semantics (stakeholder, 2026-07-14):
 * - ACCEPTED checkbox: the accepted iteration is the working basis — new
 *   updates always work off the accepted one; if nothing is accepted, the
 *   last one is used (unless the user explicitly says otherwise in chat).
 *   Accepting one un-accepts any other.
 * - FRONT/BACK pulldown (postcards make two images): marking an iteration
 *   as front clears the front mark from whichever iteration held it —
 *   make a revision, and if you like it, mark it front; the old front is
 *   released. Same rule for back. The front is what the project list
 *   (/mockups/projects) shows as the project's hero image.
 */
export default function MockupOutputPane() {
  const [acceptedId, setAcceptedId] = useState<string | null>(null);
  const [roles, setRoles] = useState<Record<'front' | 'back', string | null>>({
    front: 'iter-002',
    back: null,
  });

  const last = STUB_OUTPUT_ITERATIONS[STUB_OUTPUT_ITERATIONS.length - 1];
  const accepted = STUB_OUTPUT_ITERATIONS.find((it) => it.id === acceptedId);
  const workingFrom = accepted
    ? `${accepted.label} (accepted)`
    : `${last.label} (last — nothing accepted)`;

  function roleOf(id: string): IterationRole {
    if (roles.front === id) return 'front';
    if (roles.back === id) return 'back';
    return 'none';
  }

  function setRole(id: string, role: IterationRole) {
    setRoles((prev) => {
      const next = { ...prev };
      // Release any role this iteration currently holds.
      if (next.front === id) next.front = null;
      if (next.back === id) next.back = null;
      // Claiming a role releases it from the previous holder.
      if (role === 'front') next.front = id;
      if (role === 'back') next.back = id;
      return next;
    });
  }

  const markedSides = (['front', 'back'] as const)
    .filter((s) => roles[s] !== null)
    .map((s) => ({
      side: s,
      label:
        STUB_OUTPUT_ITERATIONS.find((it) => it.id === roles[s])?.label ?? '',
    }));

  return (
    <section className="flex-[3] min-h-0 overflow-y-auto border-b border-slate-200 p-4">
      <header className="mb-4 flex items-start gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">{STUB_PROJECT_NAME}</h1>
          <p className="text-sm text-slate-500">{STUB_PROJECT_META}</p>
          <p data-testid="working-from" className="mt-1 text-xs text-slate-400">
            Working from: {workingFrom}
          </p>
        </div>
        <div className="ml-auto flex flex-shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={markedSides.length === 0}
            onClick={() => openSidesPdf(markedSides)}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            PDF
          </button>
          <Link
            to="/mockups/postcard-edit"
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Text Entry
          </Link>
        </div>
      </header>

      {/* Iterations stack vertically, one per row — not side by side. */}
      <div className="flex flex-col gap-4">
        {STUB_OUTPUT_ITERATIONS.map((iteration) => (
          <div
            key={iteration.id}
            className="rounded border border-slate-200 bg-slate-100"
          >
            <div className="relative aspect-[3/2] w-full overflow-hidden">
              {iteration.image && (
                <img
                  src={iteration.image}
                  alt={iteration.label}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              )}
              <div className="absolute left-2 top-2 flex items-center gap-2">
                <span className="rounded bg-white/85 px-2 py-0.5 text-sm text-slate-700">
                  {iteration.label}
                </span>
                {iteration.isCurrent && (
                  <span className="rounded bg-indigo-600/90 px-2 py-0.5 text-xs font-semibold text-white">
                    current
                  </span>
                )}
                {roleOf(iteration.id) !== 'none' && (
                  <span
                    data-testid={`role-badge-${iteration.id}`}
                    className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold uppercase text-amber-700"
                  >
                    {roleOf(iteration.id)}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4 border-t border-slate-200 bg-white px-3 py-2 text-sm">
              <label className="flex items-center gap-1.5 text-slate-600">
                <input
                  type="checkbox"
                  aria-label={`${iteration.label} accepted`}
                  checked={acceptedId === iteration.id}
                  onChange={(event) =>
                    setAcceptedId(event.target.checked ? iteration.id : null)
                  }
                />
                Accepted
              </label>
              <label className="ml-auto flex items-center gap-1.5 text-slate-600">
                Side
                <select
                  aria-label={`${iteration.label} side`}
                  value={roleOf(iteration.id)}
                  onChange={(event) =>
                    setRole(iteration.id, event.target.value as IterationRole)
                  }
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
    </section>
  );
}
