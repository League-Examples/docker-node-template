import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import OutputPane from './OutputPane';
import ChatPanel from './ChatPanel';
import { fileUrl, type IterationDTO, type ProjectDetailDTO, type ReferenceDTO } from './types';

/**
 * `/projects/:id` -- the real two-pane project view, part 1 (ticket
 * 005-009): output pane + chat panel, promoted from
 * `pages/mockups/MockupMain.tsx` + `MockupOutputPane.tsx` +
 * `MockupChatPanel.tsx`. Renders inside `AppLayout`'s full-bleed `<main>`
 * mode (ticket 007, R2).
 *
 * A single `GET /api/projects/:id` (ticket 006) rehydrates everything --
 * `iterations`, `references`, and `chatMessages` all arrive in one
 * response, so reopening a project never needs a second round trip for
 * chat history (SUC-005) or gallery state.
 *
 * **Seam for ticket 010** (library drawer + reference *adding*): this
 * page owns and renders the reference strip (small thumbnail + remove,
 * matching `MockupMain.tsx`'s structure) since removing an already-
 * attached reference is in this ticket's scope -- but it does not render
 * the collapsible asset-browser overlay that *adds* references by
 * double-click. Ticket 010 slots that in as a sibling of `OutputPane`/
 * `ChatPanel` below (see the comment at the bottom of the returned JSX).
 */

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

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number.parseInt(id ?? '', 10);

  const [project, setProject] = useState<ProjectDetailDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadProject = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ProjectDetailDTO = await res.json();
      setProject(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project');
      setProject(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!Number.isNaN(projectId)) void loadProject();
  }, [projectId, loadProject]);

  function handleIterationsChange(next: IterationDTO[]) {
    setProject((current) => (current ? { ...current, iterations: next } : current));
  }

  async function handleRemoveReference(referenceId: number) {
    setProject((current) =>
      current ? { ...current, references: current.references.filter((r) => r.id !== referenceId) } : current,
    );
    try {
      const res = await fetch(`/api/projects/${projectId}/references/${referenceId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      // Best-effort revert: reload from the server rather than guessing
      // what the pre-removal list looked like.
      void loadProject();
    }
  }

  if (Number.isNaN(projectId)) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        <p>Invalid project</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        <p>Loading project…</p>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex h-full items-center justify-center text-red-600">
        <p>{error || 'Project not found'}</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-slate-50 text-slate-800">
      {project.references.length > 0 && (
        <div
          data-testid="project-references"
          className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2"
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">References</span>
          {project.references.map((reference) => (
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
                onClick={() => void handleRemoveReference(reference.id)}
                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-600 text-[10px] leading-none text-white hover:bg-red-600"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <OutputPane
        projectId={projectId}
        projectTitle={project.title}
        iterations={project.iterations}
        onIterationsChange={handleIterationsChange}
      />
      <ChatPanel key={projectId} projectId={projectId} initialMessages={project.chatMessages} />

      {/* Ticket 010 slots the collapsible library drawer in here, as a
          `data-testid="library-overlay"` sibling absolutely positioned
          over the two panes above (see `MockupMain.tsx`'s
          `browserOpen`/pull-tab structure) -- intentionally not built by
          this ticket. */}
    </div>
  );
}
