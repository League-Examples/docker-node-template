import { STUB_NEW_PROJECT_CHAT_MESSAGES } from './mockupStubData';
import MockupChatPanel from './MockupChatPanel';

const OUTPUT_TYPE_OPTIONS = ['Facebook image', 'Logo', 'Postcard'] as const;

/**
 * /mockups/new-project — the blank new-project flow wireframe (spec §7,
 * UC-003/SUC-003). Top to bottom: a project-details header carrying the
 * guideline questions (style, output type, goal), an empty area where
 * generated outputs will eventually appear, and the chat panel showing the
 * assistant opening the conversation by asking those same questions. All
 * form fields are non-functional (disabled) at this wireframe-fidelity
 * stage — see architecture-update.md, Decision 4 (mockups are static,
 * unauthenticated, zero fan-out).
 */
export default function MockupNewProject() {
  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white p-6">
        <h1 className="mb-4 text-lg font-semibold text-slate-800">
          New project details
        </h1>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label
              htmlFor="new-project-style"
              className="mb-1 block text-sm font-medium text-slate-600"
            >
              Style
            </label>
            <input
              id="new-project-style"
              type="text"
              placeholder="e.g. Pop Art, Comic Book, Manga…"
              disabled
              value=""
              readOnly
              className="w-full rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-400"
            />
          </div>

          <fieldset disabled>
            <legend className="mb-1 block text-sm font-medium text-slate-600">
              Output type
            </legend>
            <div className="space-y-1">
              {OUTPUT_TYPE_OPTIONS.map((option) => (
                <label
                  key={option}
                  htmlFor={`new-project-output-type-${option}`}
                  className="flex items-center gap-2 text-sm text-slate-500"
                >
                  <input
                    id={`new-project-output-type-${option}`}
                    type="radio"
                    name="new-project-output-type"
                    disabled
                    checked={false}
                    readOnly
                  />
                  {option}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label
              htmlFor="new-project-goal"
              className="mb-1 block text-sm font-medium text-slate-600"
            >
              What are you trying to achieve?
            </label>
            <textarea
              id="new-project-goal"
              placeholder="Describe the goal of this project…"
              disabled
              value=""
              readOnly
              rows={3}
              className="w-full rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-400"
            />
          </div>
        </div>
      </header>

      <section
        aria-label="Project outputs"
        className="flex flex-[3] min-h-0 items-center justify-center border-b border-slate-200 p-4"
      >
        <p className="text-sm text-slate-400">
          No outputs yet — generated iterations will appear here once you
          start the conversation below.
        </p>
      </section>

      <MockupChatPanel messages={STUB_NEW_PROJECT_CHAT_MESSAGES} />
    </div>
  );
}
