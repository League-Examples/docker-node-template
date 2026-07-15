import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import OutputPane from './OutputPane';
import ChatPanel from './ChatPanel';
import ReferenceStrip from './ReferenceStrip';
import ProjectDetailsHeader from './ProjectDetailsHeader';
import LibraryDrawer from './LibraryDrawer';
import FaceTabs from './FaceTabs';
import { usePostcardEditorState } from './usePostcardEditorState';
import type { IterationDTO, ProjectDetailDTO, ReferenceDTO, SearchCatalogMatch } from './types';
import type { PostcardSide } from '../../lib/postcardFaceEditing';

/**
 * `/projects/:id` -- the real two-pane project view (ticket 005-009 +
 * 010), rebuilt this sprint (Sprint 005 OOP change, 2026-07-15) from "one
 * gallery of every iteration" into a two-STREAM (Front/Back tabs) app with
 * inline text editing and a floating chat, per the stakeholder's explicit
 * restructure request. Promoted originally from
 * `pages/mockups/MockupMain.tsx` + `MockupOutputPane.tsx` +
 * `MockupChatPanel.tsx` + `MockupLeftBrowser.tsx`; renders inside
 * `AppLayout`'s full-bleed `<main>` mode (ticket 007, R2).
 *
 * **This sprint's model change**: `Iteration.role` is now STREAM
 * MEMBERSHIP ('front' | 'back'), not "the single front/back" -- MANY
 * iterations can share a role. `Iteration.accepted` is one-accepted-PER-
 * STREAM (`catalogTools.ts`'s `set_iteration_state` enforces this
 * server-side, scoped to `(projectId, role)`). This page owns `activeTab`
 * (which stream is showing) and filters/tags accordingly; see
 * `OutputPane.tsx`'s own module header for the stream-filtering/inline-
 * editor details.
 *
 * **Layout (Sprint 005 OOP change, 2026-07-15)**: three-region column,
 * matching the stakeholder's explicit fixed-top/scroll-middle/fixed-bottom
 * spec --
 *   1. FIXED top: `ProjectDetailsHeader` + `ReferenceStrip` (unchanged
 *      from before) + a new title/tabs/PDF row (back link, project title,
 *      `FaceTabs`, PDF button) -- none of this scrolls.
 *   2. SCROLLING middle: `OutputPane`'s iteration stream, the only thing
 *      that scrolls. Its scroll container reserves `CHAT_PANEL_HEIGHT_PX`
 *      of bottom padding so the floating chat below never overlaps the
 *      last row.
 *   3. FIXED bottom: `ChatPanel`, `absolute`-positioned to the bottom of
 *      this page's own `relative` root at a fixed height, always visible
 *      regardless of scroll position -- replacing the old layout where
 *      chat claimed remaining flex space below a scrolling gallery.
 *
 * **Postcard content is now owned HERE** (Sprint 005 OOP change,
 * 2026-07-15): `usePostcardEditorState` (one instance, covering both
 * faces) replaces `OutputPane.tsx`'s old read-only `postcardContent`
 * fetch AND the deleted `PostcardEdit.tsx` page's load/autosave -- see
 * that hook's own module header. The PDF button lives in this file's
 * fixed header row (not `OutputPane.tsx`, which used to own it) because it
 * now needs this same hook's `flushPendingAutosave`/`buildContentPayload`.
 *
 * A single `GET /api/projects/:id` (ticket 006) rehydrates everything --
 * `iterations`, `references`, and `chatMessages` all arrive in one
 * response, so reopening a project never needs a second round trip for
 * chat history (SUC-005) or gallery state.
 *
 * **Ticket 010's two additions**: `LibraryDrawer.tsx` -- the collapsible
 * asset-browser overlay that *adds* references by double-click (SUC-002/
 * SUC-003) -- and the SUC-015 wiring that forwards `ChatPanel`'s
 * `tool_call_finished` events for `search_catalog` down into the drawer
 * via `searchCatalogMatches`, without opening a second SSE connection.
 *
 * **Ticket 011 (SUC-004, "New project")**: this same route *is* the "new
 * project" experience -- a fresh project simply renders with empty
 * `iterations`/`references`/`chatMessages`, and `activeTab` starts on
 * `'front'` (a new project starts on Front, per this sprint's spec).
 *
 * **No `/postcard` route** (Sprint 005 OOP change, 2026-07-15): the
 * standalone text-region editor page and its "Text Entry" nav button are
 * both deleted -- editing now happens inline on whichever iteration is
 * accepted in the active stream (`OutputPane.tsx`).
 */

/** Fixed height (px) of the floating chat panel pinned to the bottom of
 * this page -- also used as the scrolling stream's bottom padding so the
 * chat never overlaps the last iteration row (module header). */
const CHAT_PANEL_HEIGHT_PX = 288;

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

  // Which stream tab is showing -- a new project starts on Front (module
  // header). Threaded into `OutputPane` (filters the stream), `ChatPanel`
  // (tags new generate_image iterations), and the inline editor.
  const [activeTab, setActiveTab] = useState<PostcardSide>('front');

  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');

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

  const iterations = project?.iterations ?? [];
  const acceptedFront = iterations.find((i) => i.role === 'front' && i.accepted);
  const acceptedBack = iterations.find((i) => i.role === 'back' && i.accepted);
  const hasAcceptedSide = Boolean(acceptedFront || acceptedBack);

  const postcardEditor = usePostcardEditorState(projectId, acceptedFront?.imagePath, acceptedBack?.imagePath);

  /** PDF button (fixed header, module header): flushes any pending
   * autosave, then PUTs the exact same content-JSON payload (this always
   * carries fresh `front_image`/`back_image` from the currently accepted
   * iterations, plus both faces' regions/QR -- see
   * `usePostcardEditorState.buildContentPayload`) before rendering. This
   * replaces the old `OutputPane.tsx`'s "fetch existing, then only replace
   * image paths" dance -- `postcardEditor`'s own state is now the single
   * live source of truth for the whole content JSON, so a fresh PUT of its
   * current payload is already the merge-safe, never-clobber operation the
   * old handler achieved via a separate GET. */
  async function handleGeneratePdf() {
    if (!hasAcceptedSide || !postcardEditor.loaded || pdfBusy) return;
    setPdfBusy(true);
    setPdfError('');
    try {
      await postcardEditor.flushPendingAutosave();
      const content = postcardEditor.buildContentPayload();
      if (!content) return;

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
      {/* Fixed top: never scrolls. */}
      <div className="flex-shrink-0">
        <ProjectDetailsHeader detailsHeader={project.detailsHeader} />
        <ReferenceStrip references={project.references} onRemove={(id) => void handleRemoveReference(id)} />

        <header className="flex items-start gap-4 border-b border-slate-200 bg-white px-4 py-3">
          <Link
            to="/"
            aria-label="Back to projects"
            className="rounded border border-slate-300 px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-50"
          >
            ←
          </Link>
          <h1 className="text-lg font-semibold text-slate-800">{project.title}</h1>

          <div className="mx-auto">
            <FaceTabs active={activeTab} onChange={setActiveTab} />
          </div>

          <div className="flex flex-shrink-0 items-center gap-2">
            {pdfError && <span className="text-xs text-red-600">{pdfError}</span>}
            <button
              type="button"
              disabled={!hasAcceptedSide || !postcardEditor.loaded || pdfBusy}
              onClick={() => void handleGeneratePdf()}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {pdfBusy ? 'Generating…' : 'PDF'}
            </button>
          </div>
        </header>
      </div>

      {/* Scrolling middle: the only region that scrolls. */}
      <OutputPane
        projectId={projectId}
        iterations={iterations}
        activeTab={activeTab}
        onIterationsChange={handleIterationsChange}
        postcardEditor={postcardEditor}
        scrollPaddingBottomPx={CHAT_PANEL_HEIGHT_PX}
      />

      {/* Fixed bottom: floating chat, always visible. */}
      <div
        className="absolute inset-x-0 bottom-0 z-20 border-t border-slate-200 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]"
        style={{ height: CHAT_PANEL_HEIGHT_PX }}
      >
        <ChatPanel
          key={projectId}
          projectId={projectId}
          initialMessages={project.chatMessages}
          onToolCallFinished={handleToolCallFinished}
          activeFace={activeTab}
        />
      </div>

      <LibraryDrawer
        projectId={projectId}
        onReferenceAdded={handleReferenceAdded}
        searchCatalogMatches={searchCatalogMatches}
      />
    </div>
  );
}
