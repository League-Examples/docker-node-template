import type { ProjectDetailDTO } from './types';

/**
 * The project-details header at the top of `/projects/:id` (ticket
 * 005-011, SUC-004): promoted from `MockupNewProject.tsx`'s disabled
 * style/output-type/goal form fields into a *read-only* summary of
 * `Project.detailsHeader`.
 *
 * Unlike the mockup, this is never a form -- per the stakeholder's own
 * framing ("It might ask you for details... these are general
 * guidelines"), `detailsHeader` is filled exclusively by Claude via the
 * chat's `create_project` update path (Sprint 003, unchanged) as the
 * conversation proceeds, not by direct field entry. A freshly-created
 * project has no `detailsHeader` yet, so this renders a single blank-state
 * line instead of three empty fields -- once any of the three guideline
 * values (style / output type / goal) arrives, the full three-column
 * summary takes over, and each field that's still missing renders its own
 * "Not set yet" placeholder rather than blanking the whole header again.
 * The next `GET /api/projects/:id` (triggered by `ProjectDetail/index.tsx`
 * on mount, or a future reload) is what surfaces Claude's updates -- this
 * component itself never fetches.
 *
 * **Description (OOP follow-up, 2026-07-16)**: `ProjectList.tsx`'s "New
 * project" modal collects a free-text description at create time,
 * persisted onto this same `detailsHeader` JSON (`description` key --
 * `routes/projects.ts`'s `POST /projects`). It renders as a plain
 * paragraph above the style/output-type/goal grid whenever present, and
 * counts toward the blank-state check like the other three fields.
 */

interface ProjectDetailsHeaderProps {
  detailsHeader: ProjectDetailDTO['detailsHeader'];
}

interface DetailsHeaderFields {
  style?: string;
  outputType?: string;
  goal?: string;
  /** The "New project" modal's description field (OOP follow-up,
   * 2026-07-16) -- see the module header. */
  description?: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Reads the same `style`/`outputType` keys `ProjectList.tsx`'s
 * `projectKindLabel` already established for the project-card "kind"
 * line, plus `goal` -- the third guideline question (SUC-004's Main
 * Flow step 4: "style, output type, goal") -- and `description`, the
 * free-text brief collected by the "New project" modal at create time
 * (`routes/projects.ts`'s `POST /projects`, OOP follow-up, 2026-07-16). */
function parseDetailsHeader(detailsHeader: ProjectDetailDTO['detailsHeader']): DetailsHeaderFields {
  if (!detailsHeader || typeof detailsHeader !== 'object') return {};
  const header = detailsHeader as Record<string, unknown>;
  return {
    style: asString(header.style),
    outputType: asString(header.outputType),
    goal: asString(header.goal),
    description: asString(header.description),
  };
}

export default function ProjectDetailsHeader({ detailsHeader }: ProjectDetailsHeaderProps) {
  const fields = parseDetailsHeader(detailsHeader);
  const isBlank = !fields.style && !fields.outputType && !fields.goal && !fields.description;

  return (
    <header data-testid="project-details-header" className="border-b border-slate-200 bg-white px-4 py-3">
      {isBlank ? (
        <p className="text-sm text-slate-400">
          No project details yet — Claude will ask about style, output type, and goal as the conversation gets
          started.
        </p>
      ) : (
        <>
          {fields.description && <p className="mb-2 text-sm text-slate-700">{fields.description}</p>}
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="font-medium text-slate-600">Style</dt>
              <dd className={fields.style ? 'text-slate-800' : 'text-slate-400'}>{fields.style ?? 'Not set yet'}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-600">Output type</dt>
              <dd className={fields.outputType ? 'text-slate-800' : 'text-slate-400'}>
                {fields.outputType ?? 'Not set yet'}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-600">Goal</dt>
              <dd className={fields.goal ? 'text-slate-800' : 'text-slate-400'}>{fields.goal ?? 'Not set yet'}</dd>
            </div>
          </dl>
        </>
      )}
    </header>
  );
}
