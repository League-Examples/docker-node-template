import {
  STUB_OUTPUT_ITERATIONS,
  STUB_PROJECT_META,
  STUB_PROJECT_NAME,
} from './mockupStubData';

/**
 * Top three-quarters of the right pane: the project-output view (spec §2,
 * §6). Shows the current project's generated iterations, most recent
 * first, never overwritten (spec §6 grounding).
 */
export default function MockupOutputPane() {
  return (
    <section className="flex-[3] min-h-0 overflow-y-auto border-b border-slate-200 p-4">
      <header className="mb-4">
        <h1 className="text-lg font-semibold text-slate-800">{STUB_PROJECT_NAME}</h1>
        <p className="text-sm text-slate-500">{STUB_PROJECT_META}</p>
      </header>

      {/* Iterations stack vertically, one per row — not side by side. */}
      <div className="flex flex-col gap-4">
        {STUB_OUTPUT_ITERATIONS.map((iteration) => (
          <div
            key={iteration.id}
            className="flex aspect-[3/2] w-full flex-col items-center justify-center rounded border border-slate-200 bg-slate-100 text-sm text-slate-500"
          >
            <span>{iteration.label}</span>
            {iteration.isCurrent && (
              <span className="mt-1 text-xs font-semibold text-indigo-600">current</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
