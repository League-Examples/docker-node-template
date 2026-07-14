import { useState } from 'react';
import {
  STUB_OUTPUT_ITERATIONS,
  STUB_PROJECT_META,
  STUB_PROJECT_NAME,
} from './mockupStubData';

type IterationRole = 'none' | 'front' | 'back';

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

  return (
    <section className="flex-[3] min-h-0 overflow-y-auto border-b border-slate-200 p-4">
      <header className="mb-4">
        <h1 className="text-lg font-semibold text-slate-800">{STUB_PROJECT_NAME}</h1>
        <p className="text-sm text-slate-500">{STUB_PROJECT_META}</p>
        <p data-testid="working-from" className="mt-1 text-xs text-slate-400">
          Working from: {workingFrom}
        </p>
      </header>

      {/* Iterations stack vertically, one per row — not side by side. */}
      <div className="flex flex-col gap-4">
        {STUB_OUTPUT_ITERATIONS.map((iteration) => (
          <div
            key={iteration.id}
            className="rounded border border-slate-200 bg-slate-100"
          >
            <div className="flex aspect-[3/2] w-full flex-col items-center justify-center text-sm text-slate-500">
              <span>{iteration.label}</span>
              {iteration.isCurrent && (
                <span className="mt-1 text-xs font-semibold text-indigo-600">current</span>
              )}
              {roleOf(iteration.id) !== 'none' && (
                <span
                  data-testid={`role-badge-${iteration.id}`}
                  className="mt-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold uppercase text-amber-700"
                >
                  {roleOf(iteration.id)}
                </span>
              )}
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
