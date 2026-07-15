import { fileUrl, type ReferenceDTO } from './types';

/**
 * The project's reference strip (promoted from `MockupMain.tsx`'s
 * in-memory `references` chip rendering, ticket 005-009; extracted into
 * its own component by ticket 010 so `LibraryDrawer.tsx`'s double-click
 * *add* path and this component's *remove* path both operate on the same
 * `ProjectDetail/index.tsx`-owned `project.references` state without
 * duplicating the render logic between the two tickets).
 *
 * Renders each attached `Reference` as a small image thumbnail with an X
 * in the upper corner (stakeholder round 8) -- never a text lozenge
 * (SUC-003 acceptance criterion). Renders nothing at all when there are no
 * references, matching `MockupMain.tsx`'s original `references.length > 0`
 * gate.
 */

interface ReferenceStripProps {
  references: ReferenceDTO[];
  onRemove: (referenceId: number) => void;
}

/** Human label for a reference chip, derived from its asset's workspace
 * path the same way `ProjectList.tsx`'s `assetLabel` derives a Library
 * card's label (e.g. "assets/logo-robot.png" -> "logo robot"). Falls back
 * to the reference's role if the nested asset wasn't resolved. */
function referenceLabel(reference: ReferenceDTO): string {
  const path = reference.asset?.path;
  if (!path) return reference.role;
  const base = path.split('/').pop() ?? path;
  const withoutExtension = base.replace(/\.[^./]+$/, '');
  const label = withoutExtension.replace(/[-_]+/g, ' ').trim();
  return label.length > 0 ? `${label} · ${reference.role}` : reference.role;
}

export default function ReferenceStrip({ references, onRemove }: ReferenceStripProps) {
  if (references.length === 0) return null;

  return (
    <div
      data-testid="project-references"
      className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2"
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">References</span>
      {references.map((reference) => (
        <span
          key={reference.id}
          className="relative flex items-center gap-2 rounded border border-indigo-200 bg-indigo-50 py-1 pl-1 pr-2 text-xs text-indigo-700"
        >
          {reference.asset?.path ? (
            <img
              src={fileUrl(reference.asset.path)}
              alt=""
              className="h-8 w-12 rounded-sm object-cover"
            />
          ) : (
            <span className="h-8 w-12 rounded-sm bg-slate-200" aria-hidden="true" />
          )}
          {referenceLabel(reference)}
          <button
            type="button"
            aria-label={`Remove ${referenceLabel(reference)}`}
            onClick={() => onRemove(reference.id)}
            className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-600 text-[10px] leading-none text-white hover:bg-red-600"
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
