import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { PostcardContentDTO } from './ProjectDetail/types';
import PostcardOverlay from './ProjectDetail/PostcardOverlay';
import { useMeasuredWidth } from '../lib/useMeasuredWidth';
import { postcardFaceRegions, postcardFaceQr } from '../lib/postcardFaceContent';

/**
 * Post-login landing page — the project list (SUC-010/SUC-011). Promoted
 * from the wireframe `pages/mockups/MockupProjects.tsx` (ticket 008) to a
 * real, data-bound page: My/All/Archive are `GET /api/projects?view=`
 * (ticket 006), Library is `GET /api/catalog/tree` (ticket 005), and every
 * hero/asset image renders via `GET /api/files/*` (ticket 004).
 *
 * **Hero-image rule** (stakeholder round 6, SUC-010): each project card's
 * hero is its most recently accepted iteration; if a project has an
 * accepted `role: 'back'` iteration *and* a separate accepted `role:
 * 'front'` (or unmarked) iteration, the front/unmarked one wins — a
 * postcard's hero is never its back. Falls back to the last iteration
 * overall if nothing is accepted. See `selectHeroIteration` below.
 *
 * **New project** (SUC-004 entry point): `POST /api/projects` then
 * navigate to `/projects/:id` — this is the button-click path ticket 011
 * (`NewProject`) itself defers to this page for.
 *
 * **Library-asset-to-project flow** (stakeholder round 12, SUC-011):
 * clicking a Library asset calls `POST /api/projects` with
 * `{ sourceAssetId }`; ticket 006's route pre-attaches the asset as the
 * new project's first `Reference` server-side in the same round trip, so
 * navigating straight to `/projects/:id` already shows it in the
 * reference strip (ticket 010) with no further action.
 *
 * **Bulk select/archive/delete** (OOP follow-up, 2026-07-15): each project
 * card in the My/All/Archive views (never Library, which shows assets, not
 * projects) carries a selection checkbox rendered outside the card's own
 * `Link` -- clicking it stops propagation and never bubbles into the
 * `Link`, so it never triggers card navigation. Selecting one or more
 * projects shows a sticky action bar: My/All offer Archive, Archive offers
 * Restore (both a `PATCH /api/projects/:id` per selected id, delegating
 * server-side to `create_project`'s update path), and every view offers
 * Delete (`DELETE /api/projects/:id` per selected id, delegating to the new
 * `remove_project` tool) gated behind a confirmation step -- mirroring
 * `OutputPane.tsx`'s per-row delete-confirmation popup, just scoped to the
 * whole selection instead of one row. Any bulk action clears the selection
 * and refetches the current view afterward so the list reflects the change.
 *
 * **Hero-card rendered-text overlay (OOP change, 2026-07-15)**: each card's
 * hero image now overlays whatever postcard text/QR was last saved for
 * whichever face `selectHeroIteration` picked -- the exact same read-only
 * `ProjectDetail/PostcardOverlay` component `OutputPane.tsx`'s iteration
 * gallery already renders, not a second hand-built preview. The saved
 * content itself rides along on `GET /api/projects`'s response as each
 * row's new `postcardContent` field (`routes/projects.ts`'s
 * `PROJECT_LIST_INCLUDE` extension) -- no follow-up per-card fetch. Which
 * face's `front_regions`/`back_regions`/`front_qr`/`back_qr` applies is
 * decided by the hero iteration's own `role`, via the shared
 * `../lib/postcardFaceContent` helper (also used by `OutputPane.tsx`), and
 * the overlay is scaled to the hero image's actual on-screen pixel width
 * via the shared `../lib/useMeasuredWidth` hook (ditto) -- see `HeroImage`
 * below, which mirrors `OutputPane.tsx`'s `IterationImage` almost exactly,
 * just with the card's own aspect-ratio-box sizing instead of the
 * gallery's 800px cap. A project with no saved postcard content, or whose
 * hero has no `role` at all, renders the bare image exactly as before --
 * see `HeroImage`'s own `showOverlay` gate.
 */

type ProjectView = 'mine' | 'all' | 'library' | 'archive';

const VIEW_LABELS: Record<ProjectView, string> = {
  mine: 'My projects',
  all: 'All projects',
  library: 'Library',
  archive: 'Archive',
};

const PROJECT_VIEWS: ProjectView[] = ['mine', 'all', 'library', 'archive'];

interface IterationSummary {
  id: number;
  seq: number;
  imagePath: string;
  accepted: boolean;
  role: string | null;
}

interface ProjectOwner {
  id: number;
  email: string;
  displayName: string | null;
}

interface ProjectSummary {
  id: number;
  title: string;
  status: string;
  detailsHeader?: Record<string, unknown> | null;
  owner?: ProjectOwner | null;
  iterations?: IterationSummary[];
  /** Saved postcard text/QR content (OOP change, 2026-07-15) -- see the
   * module header's "Hero-card rendered-text overlay" section.
   * `routes/projects.ts`'s `GET /projects` sends `null` for a project with
   * nothing saved yet (or an unreadable/malformed content file), same
   * "absent means bare image" contract `OutputPane.tsx` already follows for
   * its own `GET /api/postcards/:projectId` fetch. */
  postcardContent?: PostcardContentDTO | null;
}

interface CatalogAssetItem {
  id: number;
  path: string;
  description?: string;
}

interface CatalogCollection {
  id: number;
  name: string;
  kind: string;
  assets: CatalogAssetItem[];
}

interface CatalogDirectory {
  id: number;
  parentId: number | null;
  path: string;
  name: string;
  kind: string;
  collections: CatalogCollection[];
}

/**
 * SUC-010's hero-image selection rule, in one place so both the render
 * path and the tests exercise the exact same logic. `seq` (an
 * `Iteration`'s creation order within its project) stands in for
 * "recency" — the schema carries no separate acceptedAt timestamp, and
 * iterations are always created and accepted in sequence.
 *
 * **Sprint 005 OOP change, 2026-07-15**: `role` is now stream membership
 * (MANY iterations can be `role: 'front'`), not a single front/back slot,
 * and `accepted` is one-accepted-PER-STREAM. "The postcard's front" is
 * therefore the front stream's ACCEPTED iteration -- not just any
 * `role: 'front'` iteration as the old (pre-Sprint-005) rule read. Falls
 * back to the front stream's most recent iteration when nothing in it is
 * accepted yet (still never the back), then to the pre-existing
 * accepted/non-back/last-overall chain for a project with no front-stream
 * iteration at all (a legacy/pre-migration project, or every iteration is
 * `role: null`).
 */
export function selectHeroIteration(iterations: IterationSummary[]): IterationSummary | null {
  if (!iterations || iterations.length === 0) return null;

  const frontStream = iterations.filter((iteration) => iteration.role === 'front');
  const acceptedFront = frontStream.filter((iteration) => iteration.accepted);
  if (acceptedFront.length > 0) {
    return acceptedFront.reduce((latest, current) => (current.seq > latest.seq ? current : latest));
  }
  if (frontStream.length > 0) {
    // No accepted front yet -- the most recent front-stream iteration is
    // still the best stand-in for "the postcard's front" (never the back).
    return frontStream.reduce((latest, current) => (current.seq > latest.seq ? current : latest));
  }

  // No front-stream iteration at all -- fall back to whatever's accepted,
  // preferring non-back, else the last iteration overall.
  const accepted = iterations.filter((iteration) => iteration.accepted);
  if (accepted.length === 0) {
    return iterations.reduce((latest, current) => (current.seq > latest.seq ? current : latest));
  }
  const nonBack = accepted.filter((iteration) => iteration.role !== 'back');
  const pool = nonBack.length > 0 ? nonBack : accepted;
  return pool.reduce((latest, current) => (current.seq > latest.seq ? current : latest));
}

/** Human caption under a card's hero image, e.g. "Front — Iteration 2
 * (accepted)" or "Iteration 3 (last — nothing accepted)". */
function heroCaption(iteration: IterationSummary | null): string {
  if (!iteration) return 'No iterations yet';
  const roleLabel = iteration.role === 'front' ? 'Front — ' : iteration.role === 'back' ? 'Back — ' : '';
  // A front hero shown because it's the front (not because it's accepted)
  // shouldn't read "nothing accepted" -- that caption only applies to the
  // non-front fallback.
  if (iteration.role === 'front' && !iteration.accepted) {
    return `${roleLabel}Iteration ${iteration.seq}`;
  }
  const acceptedLabel = iteration.accepted ? 'accepted' : 'last — nothing accepted';
  return `${roleLabel}Iteration ${iteration.seq} (${acceptedLabel})`;
}

/** Renders any workspace-relative path (an `Iteration.imagePath` or an
 * `Asset.path`) via ticket 004's `GET /api/files/*` route. */
function fileUrl(relativePath: string): string {
  return `/api/files/${relativePath}`;
}

/** A card's hero image, plus (when the hero iteration's face has saved
 * postcard content) a `PostcardOverlay` scaled to match -- the module
 * header's "Hero-card rendered-text overlay" section. Mirrors
 * `ProjectDetail/OutputPane.tsx`'s `IterationImage` almost exactly (same
 * shared `useMeasuredWidth` hook, same `showOverlay` gate), just sized to
 * the card's fixed `aspect-[3/2]` box instead of the gallery's 800px cap --
 * kept as its own small component (rather than inlined in the card loop
 * below) so the `<img ref>` measuring hook has a stable per-card element to
 * attach to. */
function HeroImage({
  imagePath,
  overlayRegions,
  overlayQr,
}: {
  imagePath: string;
  overlayRegions?: PostcardContentDTO['front_regions'];
  overlayQr?: PostcardContentDTO['front_qr'];
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const { widthPx, measure } = useMeasuredWidth(imgRef, imagePath);

  const showOverlay = (overlayRegions && overlayRegions.length > 0) || !!overlayQr;

  return (
    <div className="relative mb-1 aspect-[3/2] w-full overflow-hidden rounded">
      <img
        ref={imgRef}
        src={fileUrl(imagePath)}
        alt=""
        onLoad={measure}
        className="h-full w-full object-cover"
      />
      {showOverlay && <PostcardOverlay regions={overlayRegions ?? []} qr={overlayQr} widthPx={widthPx} />}
    </div>
  );
}

/** Best-effort "kind" line from `Project.detailsHeader` (free-form JSON,
 * filled progressively by Claude via chat — see ticket 011) -- e.g.
 * "Postcard · Pop Art". Renders nothing if the header hasn't been filled
 * in yet (a brand-new project). */
function projectKindLabel(detailsHeader: ProjectSummary['detailsHeader']): string | null {
  if (!detailsHeader || typeof detailsHeader !== 'object') return null;
  const header = detailsHeader as Record<string, unknown>;
  const parts = [header.outputType, header.style].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Human label for a Library asset card, derived from its workspace path
 * (e.g. "assets/logo-robot.png" -> "logo robot"). */
function assetLabel(asset: CatalogAssetItem): string {
  const base = asset.path.split('/').pop() ?? asset.path;
  const withoutExtension = base.replace(/\.[^./]+$/, '');
  const label = withoutExtension.replace(/[-_]+/g, ' ').trim();
  return label.length > 0 ? label : asset.path;
}

export default function ProjectList() {
  const navigate = useNavigate();

  const [view, setView] = useState<ProjectView>('mine');

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState('');

  const [directories, setDirectories] = useState<CatalogDirectory[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState('');

  const [creating, setCreating] = useState(false);

  // Bulk select/archive/delete (OOP follow-up, 2026-07-15) -- see module
  // header. Selection is view-scoped: switching views clears it, since a
  // project selected in one view's list has no meaning once that list is
  // gone.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState('');

  const loadProjects = useCallback(async (activeView: Exclude<ProjectView, 'library'>) => {
    setProjectsLoading(true);
    setProjectsError('');
    try {
      const res = await fetch(`/api/projects?view=${activeView}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProjects(Array.isArray(data.projects) ? data.projects : []);
    } catch (err) {
      setProjectsError(err instanceof Error ? err.message : 'Failed to load projects');
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true);
    setLibraryError('');
    try {
      const res = await fetch('/api/catalog/tree');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDirectories(Array.isArray(data.directories) ? data.directories : []);
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : 'Failed to load the library');
      setDirectories([]);
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view === 'library') {
      void loadLibrary();
    } else {
      void loadProjects(view);
    }
  }, [view, loadProjects, loadLibrary]);

  useEffect(() => {
    setSelectedIds(new Set());
    setConfirmDeleteOpen(false);
    setBulkError('');
  }, [view]);

  function toggleSelected(projectId: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }

  /** Fires each selected id's request in parallel, then -- only if every
   * one succeeded -- clears the selection and refetches the current view.
   * `view` is narrowed to non-`'library'` by the `view === 'library'`
   * guard at each caller (the action bar itself only renders outside the
   * Library view, so this is never actually reached with `view ===
   * 'library'`, but the guard keeps `loadProjects`'s parameter type
   * honest). */
  async function runBulkAction(action: (projectId: number) => Promise<Response>, failureMessage: string) {
    if (view === 'library') return;
    setBulkBusy(true);
    setBulkError('');
    try {
      const results = await Promise.all(Array.from(selectedIds).map(action));
      if (results.some((res) => !res.ok)) throw new Error(failureMessage);
      setSelectedIds(new Set());
      setConfirmDeleteOpen(false);
      await loadProjects(view);
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : failureMessage);
    } finally {
      setBulkBusy(false);
    }
  }

  function patchStatus(status: 'active' | 'archived') {
    return (projectId: number) =>
      fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
  }

  async function handleBulkArchive() {
    await runBulkAction(patchStatus('archived'), 'Failed to archive one or more projects');
  }

  async function handleBulkRestore() {
    await runBulkAction(patchStatus('active'), 'Failed to restore one or more projects');
  }

  async function handleBulkDeleteConfirmed() {
    await runBulkAction(
      (projectId) => fetch(`/api/projects/${projectId}`, { method: 'DELETE' }),
      'Failed to delete one or more projects',
    );
  }

  async function handleNewProject() {
    setCreating(true);
    setProjectsError('');
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Untitled project' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created = await res.json();
      navigate(`/projects/${created.id}`);
    } catch (err) {
      setProjectsError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setCreating(false);
    }
  }

  async function handleLibraryAssetClick(asset: CatalogAssetItem) {
    setLibraryError('');
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: assetLabel(asset), sourceAssetId: asset.id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created = await res.json();
      navigate(`/projects/${created.id}`);
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : 'Failed to create project from asset');
    }
  }

  const collectionsWithAssets = directories.flatMap((dir) =>
    dir.collections.filter((collection) => collection.assets.length > 0).map((collection) => ({ dir, collection })),
  );

  return (
    <div className="min-h-screen bg-slate-50 p-8 text-slate-800">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-800">Projects</h1>
            <p className="text-sm text-slate-500">
              Hero image = most recently accepted iteration; postcards show
              their front.
            </p>
          </div>
          <button
            type="button"
            disabled={creating}
            onClick={() => void handleNewProject()}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {creating ? 'Creating…' : 'New project'}
          </button>
        </div>

        <div
          role="group"
          aria-label="Project views"
          className="mb-4 inline-flex overflow-hidden rounded border border-slate-300"
        >
          {PROJECT_VIEWS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={
                view === option
                  ? 'bg-indigo-600 px-4 py-2 text-sm font-semibold text-white'
                  : 'bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50'
              }
            >
              {VIEW_LABELS[option]}
            </button>
          ))}
        </div>

        {view !== 'library' && selectedIds.size > 0 && (
          <div
            data-testid="bulk-action-bar"
            className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-3 rounded border border-indigo-200 bg-indigo-50 px-4 py-2"
          >
            {confirmDeleteOpen ? (
              <>
                <p className="text-sm font-medium text-slate-700">
                  Delete {selectedIds.size} project{selectedIds.size === 1 ? '' : 's'}? This can&apos;t be undone.
                </p>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="Confirm delete selected projects"
                    disabled={bulkBusy}
                    onClick={() => void handleBulkDeleteConfirmed()}
                    className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteOpen(false)}
                    className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-slate-700">{selectedIds.size} selected</p>
                <div className="ml-auto flex items-center gap-2">
                  {view === 'archive' ? (
                    <button
                      type="button"
                      aria-label="Restore selected projects"
                      disabled={bulkBusy}
                      onClick={() => void handleBulkRestore()}
                      className="rounded border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                    >
                      Restore
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-label="Archive selected projects"
                      disabled={bulkBusy}
                      onClick={() => void handleBulkArchive()}
                      className="rounded border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                    >
                      Archive
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="Delete selected projects"
                    onClick={() => setConfirmDeleteOpen(true)}
                    className="rounded border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set())}
                    className="rounded px-3 py-1.5 text-sm text-slate-500 hover:bg-white"
                  >
                    Clear
                  </button>
                </div>
              </>
            )}
            {bulkError && <p className="w-full text-xs text-red-600">{bulkError}</p>}
          </div>
        )}

        {view === 'library' ? (
          <div>
            <p className="mb-3 text-sm text-slate-500">
              Click an asset to create a project for it — manipulate it as a
              project, then put it back into the library (usually by asking
              the AI).
            </p>
            {libraryError && <p className="mb-3 text-sm text-red-600">{libraryError}</p>}
            {libraryLoading ? (
              <p className="text-sm text-slate-400">Loading library…</p>
            ) : collectionsWithAssets.length === 0 ? (
              <p className="text-sm text-slate-400">No library assets yet.</p>
            ) : (
              collectionsWithAssets.map(({ dir, collection }) => (
                <section key={collection.id} className="mb-5">
                  <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                    {dir.name} · {collection.name}
                  </h2>
                  <ul className="grid grid-cols-3 gap-3">
                    {collection.assets.map((asset) => (
                      <li key={asset.id}>
                        <button
                          type="button"
                          onClick={() => void handleLibraryAssetClick(asset)}
                          aria-label={`Create a project for ${assetLabel(asset)}`}
                          className="block w-full rounded-lg border border-slate-200 bg-white p-2 text-left hover:border-indigo-400"
                        >
                          <img
                            src={fileUrl(asset.path)}
                            alt=""
                            className="mb-1.5 aspect-video w-full rounded bg-slate-100 object-cover"
                          />
                          <p className="truncate text-sm text-slate-800">{assetLabel(asset)}</p>
                          {asset.description && (
                            <p className="truncate text-xs text-slate-400">{asset.description}</p>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>
        ) : projectsLoading ? (
          <p className="text-sm text-slate-400">Loading projects…</p>
        ) : projectsError ? (
          <p className="text-sm text-red-600">{projectsError}</p>
        ) : projects.length === 0 ? (
          <p className="text-sm text-slate-400">No projects yet.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-4">
            {projects.map((project) => {
              const heroIteration = selectHeroIteration(project.iterations ?? []);
              const kindLabel = projectKindLabel(project.detailsHeader);
              const heroOverlayRegions = postcardFaceRegions(project.postcardContent, heroIteration?.role);
              const heroOverlayQr = postcardFaceQr(project.postcardContent, heroIteration?.role);
              return (
                <li key={project.id} className="relative">
                  {/* Selection checkbox lives OUTSIDE the Link below (not
                      nested inside its anchor), so a click on it never
                      bubbles into a navigation -- stopPropagation on top is
                      belt-and-braces, matching the OOP request. */}
                  <label
                    className="absolute left-2 top-2 z-10 flex items-center justify-center rounded bg-white/90 p-1 shadow"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${project.title}`}
                      checked={selectedIds.has(project.id)}
                      onChange={(event) => {
                        event.stopPropagation();
                        toggleSelected(project.id);
                      }}
                    />
                  </label>
                  <Link
                    to={`/projects/${project.id}`}
                    className="block rounded-lg border border-slate-200 bg-white p-3 hover:border-indigo-400"
                  >
                    {heroIteration ? (
                      <HeroImage
                        imagePath={heroIteration.imagePath}
                        overlayRegions={heroOverlayRegions}
                        overlayQr={heroOverlayQr}
                      />
                    ) : (
                      <div
                        aria-hidden="true"
                        className="mb-1 flex aspect-[3/2] w-full items-center justify-center rounded bg-slate-200 text-xs text-slate-500"
                      />
                    )}
                    <p className="mb-2 text-[11px] text-slate-400">{heroCaption(heroIteration)}</p>
                    <p className="font-semibold text-slate-800">{project.title}</p>
                    {kindLabel && <p className="text-sm text-slate-500">{kindLabel}</p>}
                    {project.owner?.email && (
                      <p className="text-xs text-slate-400">{project.owner.email}</p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
