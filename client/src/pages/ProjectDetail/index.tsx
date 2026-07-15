import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import OutputPane from './OutputPane';
import ChatPanel from './ChatPanel';
import ReferenceStrip from './ReferenceStrip';
import ProjectDetailsHeader from './ProjectDetailsHeader';
import LibraryDrawer from './LibraryDrawer';
import type { IterationDTO, ProjectDetailDTO, ReferenceDTO, SearchCatalogMatch } from './types';

/**
 * `/projects/:id` -- the real two-pane project view (ticket 005-009 +
 * 010): output pane + chat panel + library drawer + reference strip,
 * promoted from `pages/mockups/MockupMain.tsx` + `MockupOutputPane.tsx` +
 * `MockupChatPanel.tsx` + `MockupLeftBrowser.tsx`. Renders inside
 * `AppLayout`'s full-bleed `<main>` mode (ticket 007, R2).
 *
 * A single `GET /api/projects/:id` (ticket 006) rehydrates everything --
 * `iterations`, `references`, and `chatMessages` all arrive in one
 * response, so reopening a project never needs a second round trip for
 * chat history (SUC-005) or gallery state.
 *
 * **Ticket 010's two additions**: `LibraryDrawer.tsx` -- the collapsible
 * asset-browser overlay that *adds* references by double-click (SUC-002/
 * SUC-003), rendered as the `data-testid="library-overlay"` sibling ticket
 * 009 left a seam for below -- and the SUC-015 wiring that forwards
 * `ChatPanel`'s `tool_call_finished` events for `search_catalog` down into
 * the drawer via `searchCatalogMatches`, without opening a second SSE
 * connection (see `ChatPanel.tsx`'s and `LibraryDrawer.tsx`'s own header
 * comments for the full rationale).
 *
 * **Ticket 011 (SUC-004, "New project")**: this same route *is* the
 * "new project" experience -- there is no separate `/projects/new` route
 * or `NewProject.tsx` component (see this ticket's Description: both the
 * `ProjectList` "New project" button and Claude's own `create_project`
 * chat path converge here once the row exists, and a fresh project simply
 * renders with empty `iterations`/`references`/`chatMessages`). This
 * ticket's one net-new piece is `ProjectDetailsHeader` below -- promoted
 * from `MockupNewProject.tsx`'s disabled style/output-type/goal fields
 * into a read-only summary of `project.detailsHeader`, which Claude fills
 * progressively via chat rather than the user filling in a form.
 */

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number.parseInt(id ?? '', 10);

  const [project, setProject] = useState<ProjectDetailDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // SUC-015: the most recent `search_catalog` tool call's matches,
  // forwarded from `ChatPanel` down into `LibraryDrawer`. `null` means "no
  // conversational search yet this page load" -- distinct from `[]`
  // ("searched, zero matches").
  const [searchCatalogMatches, setSearchCatalogMatches] = useState<SearchCatalogMatch[] | null>(null);

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

  /** `LibraryDrawer`'s double-click-add callback (SUC-003): appends the
   * newly created `Reference` to local state so the strip updates
   * immediately, deduping by id in case of a double-fire. */
  function handleReferenceAdded(reference: ReferenceDTO) {
    setProject((current) => {
      if (!current) return current;
      if (current.references.some((r) => r.id === reference.id)) return current;
      return { ...current, references: [...current.references, reference] };
    });
  }

  /** SUC-015: `ChatPanel`'s forwarded `tool_call_finished` events -- only
   * a successful `search_catalog` call updates the drawer's filtered set;
   * every other tool call (or a `search_catalog` call that errored) is
   * ignored here (the chat bubble/status text already surfaces those). */
  function handleToolCallFinished(name: string, result: unknown, isError: boolean) {
    if (name === 'search_catalog' && !isError && Array.isArray(result)) {
      setSearchCatalogMatches(result as SearchCatalogMatch[]);
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
      <ProjectDetailsHeader detailsHeader={project.detailsHeader} />
      <ReferenceStrip references={project.references} onRemove={(id) => void handleRemoveReference(id)} />

      <OutputPane
        projectId={projectId}
        projectTitle={project.title}
        iterations={project.iterations}
        onIterationsChange={handleIterationsChange}
      />
      <ChatPanel
        key={projectId}
        projectId={projectId}
        initialMessages={project.chatMessages}
        onToolCallFinished={handleToolCallFinished}
      />

      <LibraryDrawer
        projectId={projectId}
        onReferenceAdded={handleReferenceAdded}
        searchCatalogMatches={searchCatalogMatches}
      />
    </div>
  );
}
