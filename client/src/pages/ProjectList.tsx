import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

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
 */
export function selectHeroIteration(iterations: IterationSummary[]): IterationSummary | null {
  if (!iterations || iterations.length === 0) return null;

  const accepted = iterations.filter((iteration) => iteration.accepted);
  if (accepted.length === 0) {
    // Nothing accepted -- fall back to the last iteration overall.
    return iterations.reduce((latest, current) => (current.seq > latest.seq ? current : latest));
  }

  // Front/unmarked accepted iterations always win over an accepted back --
  // a postcard's hero is never its back (round 6). Only fall back to an
  // accepted back iteration if it's the only accepted one there is.
  const nonBack = accepted.filter((iteration) => iteration.role !== 'back');
  const pool = nonBack.length > 0 ? nonBack : accepted;
  return pool.reduce((latest, current) => (current.seq > latest.seq ? current : latest));
}

/** Human caption under a card's hero image, e.g. "Front — Iteration 2
 * (accepted)" or "Iteration 3 (last — nothing accepted)". */
function heroCaption(iteration: IterationSummary | null): string {
  if (!iteration) return 'No iterations yet';
  const roleLabel = iteration.role === 'front' ? 'Front — ' : iteration.role === 'back' ? 'Back — ' : '';
  const acceptedLabel = iteration.accepted ? 'accepted' : 'last — nothing accepted';
  return `${roleLabel}Iteration ${iteration.seq} (${acceptedLabel})`;
}

/** Renders any workspace-relative path (an `Iteration.imagePath` or an
 * `Asset.path`) via ticket 004's `GET /api/files/*` route. */
function fileUrl(relativePath: string): string {
  return `/api/files/${relativePath}`;
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
              return (
                <li key={project.id}>
                  <Link
                    to={`/projects/${project.id}`}
                    className="block rounded-lg border border-slate-200 bg-white p-3 hover:border-indigo-400"
                  >
                    {heroIteration ? (
                      <img
                        src={fileUrl(heroIteration.imagePath)}
                        alt=""
                        className="mb-1 aspect-[3/2] w-full rounded object-cover"
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
