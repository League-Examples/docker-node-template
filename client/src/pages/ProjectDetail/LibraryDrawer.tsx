import { useEffect, useState } from 'react';
import { fileUrl, type ReferenceDTO, type SearchCatalogMatch } from './types';

/**
 * The collapsible library drawer (ticket 010), promoted from
 * `pages/mockups/MockupLeftBrowser.tsx` + `MockupMain.tsx`'s
 * `browserOpen`/pull-tab wrapper structure -- this component now owns both
 * halves itself (the overlay wrapper *and* its contents) rather than
 * splitting them across a page and a leaf component, since ticket 009 left
 * a single seam for "the collapsible library drawer... a sibling of
 * `OutputPane`/`ChatPanel`" (`ProjectDetail/index.tsx`'s header comment).
 *
 * **Two filter modes (SUC-002/UC-014)**:
 * - *Literal* (`GET /api/catalog/search?q=`, secondary path): the filter
 *   bar fetches on every change; a non-empty query flips this component
 *   into `mode: 'literal'`, showing a flat list of matches across every
 *   category rather than the currently-active tab.
 * - *Conversational/semantic* (SUC-015, primary path): this component
 *   never opens its own SSE connection. `ChatPanel.tsx` already parses
 *   `tool_call_finished` events out of the one stream `POST
 *   /api/projects/:id/chat` returns; `ProjectDetail/index.tsx` forwards
 *   `search_catalog` results down as the `searchCatalogMatches` prop. A
 *   fresh (referentially new) value -- including an *empty* array, which is
 *   distinct from the initial `null` "never searched yet" state -- always
 *   wins, flips this into `mode: 'semantic'`, and opens the drawer if it
 *   was closed (SUC-015 step 3). An empty match set renders the
 *   broaden-your-query empty state, never an error (UC-014 E1).
 *
 * **Double-click add (SUC-003)**: only `ownerType: 'asset'` items are
 * addable -- `Reference.assetId` is a required FK to `Asset`
 * (`schema.prisma`), so a `knowledge_entry` (style/palette/composition/
 * layout) or a `project` tab item has no legal `Reference` row to create.
 * Double-clicking one of those is a deliberate no-op rather than a
 * disabled-looking control, since previewing/browsing them is still useful
 * even though adding them isn't (UC-002 step 3). A successful add posts
 * to `POST /api/projects/:id/references`, then closes the drawer
 * (stakeholder round 5) and hands the caller a fully-formed `ReferenceDTO`
 * -- including `asset.path` -- assembled from the item that was just
 * double-clicked, so `ProjectDetail/index.tsx` never needs a second
 * `GET /api/projects/:id` round trip just to learn the new reference's
 * thumbnail path.
 *
 * **Category data sources**: `GET /api/catalog/tree` only carries
 * `WorkspaceDirectory`/`Collection`/`KnowledgeEntry` rows -- it has no
 * `Project` data (`catalog.ts`'s own header flags the "projects" category
 * as a different model entirely). The four wireframe categories
 * (`assets`/`examples`/`styles`/`projects`, `mockupStubData.ts`'s
 * `LibraryCategory`) are therefore assembled here from two sources:
 * - `assets`/`examples`: `Asset` rows under `assets/*` directories,
 *   split by the one directory the workspace scaffold
 *   (`scaffold-workspace-directories.ts`) actually seeds for prior-art --
 *   `assets/prior-art` maps to "examples" (the mockup's example items were
 *   all prior-art style/composition references); every other `assets/*`
 *   directory maps to "assets".
 * - `styles`: `KnowledgeEntry` rows with `kind === 'style'` (the schema's
 *   documented enum also has `'palette'|'composition'|'layout'|'rule'|
 *   'guardrail'` -- only `'style'` matches this tab's name).
 * - `projects`: a second, already-existing read, `GET /api/projects?view=
 *   all` (ticket 006) -- browsable (each card shows its hero iteration,
 *   `ProjectList.tsx`'s own hero rule reused informally) but never
 *   double-click-addable, per the `Reference.assetId` constraint above.
 * This category split is a documented implementation choice, not a
 * literal instruction from the ticket text (which only says "backed by
 * `GET /api/catalog/tree`") -- see ticket 010's own file for the deviation
 * note.
 */

type LibraryCategory = 'assets' | 'examples' | 'styles' | 'projects';

const CATEGORY_LABELS: Record<LibraryCategory, string> = {
  assets: 'Assets',
  examples: 'Examples',
  styles: 'Styles',
  projects: 'Projects',
};

const CATEGORIES: LibraryCategory[] = ['assets', 'examples', 'styles', 'projects'];

interface CatalogAssetItem {
  id: number;
  path: string;
  description?: string;
}

interface CatalogKnowledgeEntryItem {
  id: number;
  kind: string;
  name: string;
  bodyText?: string;
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
  knowledgeEntries: CatalogKnowledgeEntryItem[];
}

interface CatalogSearchResult {
  ownerType: 'asset' | 'knowledge_entry';
  id: number;
  path?: string;
  description?: string;
  name?: string;
  bodyText?: string;
}

interface ProjectIterationSummary {
  id: number;
  seq: number;
  imagePath: string;
  accepted: boolean;
}

interface ProjectSummary {
  id: number;
  title: string;
  iterations?: ProjectIterationSummary[];
}

/** A single grid tile, normalized from whichever of the three data
 * sources above it came from. */
interface DrawerItem {
  key: string;
  ownerType: 'asset' | 'knowledge_entry' | 'project';
  /** Only present for `ownerType: 'asset'` -- the only owner type
   * `handleItemAdd` will act on. */
  assetId?: number;
  imagePath?: string;
  label: string;
  detail?: string;
}

interface LibraryDrawerProps {
  projectId: number;
  /** Called with a fully-assembled `ReferenceDTO` after a successful
   * `POST /api/projects/:id/references` -- the caller (`ProjectDetail/
   * index.tsx`) appends it to `project.references` so the reference strip
   * updates without a second fetch. */
  onReferenceAdded: (reference: ReferenceDTO) => void;
  /** The most recent `search_catalog` `tool_call_finished` result,
   * forwarded from `ChatPanel.tsx` via `ProjectDetail/index.tsx`. `null`
   * means "no conversational search has happened yet this session" --
   * distinct from an empty array, which means "searched, zero matches"
   * (SUC-015's broaden-your-query empty state). A new array reference
   * (even with identical contents) is treated as a fresh event. */
  searchCatalogMatches: SearchCatalogMatch[] | null;
}

/** e.g. "assets/logo-robot.png" -> "logo robot" -- same derivation as
 * `ProjectList.tsx`'s `assetLabel`. */
function assetLabel(path: string): string {
  const base = path.split('/').pop() ?? path;
  const withoutExtension = base.replace(/\.[^./]+$/, '');
  const label = withoutExtension.replace(/[-_]+/g, ' ').trim();
  return label.length > 0 ? label : path;
}

function directoryAssetItems(
  directories: CatalogDirectory[],
  predicate: (dir: CatalogDirectory) => boolean,
): DrawerItem[] {
  return directories.filter(predicate).flatMap((dir) =>
    dir.collections.flatMap((collection) =>
      collection.assets.map((asset) => ({
        key: `asset-${asset.id}`,
        ownerType: 'asset' as const,
        assetId: asset.id,
        imagePath: asset.path,
        label: assetLabel(asset.path),
        detail: asset.description ?? `${dir.name} · ${collection.name}`,
      })),
    ),
  );
}

function styleItems(directories: CatalogDirectory[]): DrawerItem[] {
  return directories.flatMap((dir) =>
    dir.knowledgeEntries
      .filter((entry) => entry.kind === 'style')
      .map((entry) => ({
        key: `entry-${entry.id}`,
        ownerType: 'knowledge_entry' as const,
        label: entry.name,
        detail: entry.bodyText ? entry.bodyText.slice(0, 80) : undefined,
      })),
  );
}

/** SUC-010's hero-selection rule, informally reused: most recently
 * accepted iteration, else the last iteration overall. */
function projectHero(iterations: ProjectIterationSummary[] | undefined): ProjectIterationSummary | null {
  if (!iterations || iterations.length === 0) return null;
  const accepted = iterations.filter((iteration) => iteration.accepted);
  const pool = accepted.length > 0 ? accepted : iterations;
  return pool.reduce((latest, current) => (current.seq > latest.seq ? current : latest));
}

function projectItems(projects: ProjectSummary[]): DrawerItem[] {
  return projects.map((project) => {
    const hero = projectHero(project.iterations);
    return {
      key: `project-${project.id}`,
      ownerType: 'project' as const,
      imagePath: hero?.imagePath,
      label: project.title,
    };
  });
}

function categoryItems(
  category: LibraryCategory,
  directories: CatalogDirectory[],
  projects: ProjectSummary[],
): DrawerItem[] {
  switch (category) {
    case 'assets':
      return directoryAssetItems(directories, (dir) => dir.path.startsWith('assets/') && dir.path !== 'assets/prior-art');
    case 'examples':
      return directoryAssetItems(directories, (dir) => dir.path === 'assets/prior-art');
    case 'styles':
      return styleItems(directories);
    case 'projects':
      return projectItems(projects);
    default:
      return [];
  }
}

function searchResultToItem(result: CatalogSearchResult): DrawerItem {
  if (result.ownerType === 'asset') {
    return {
      key: `asset-${result.id}`,
      ownerType: 'asset',
      assetId: result.id,
      imagePath: result.path,
      label: assetLabel(result.path ?? ''),
      detail: result.description,
    };
  }
  return {
    key: `entry-${result.id}`,
    ownerType: 'knowledge_entry',
    label: result.name ?? 'Untitled',
    detail: result.bodyText ? result.bodyText.slice(0, 80) : undefined,
  };
}

/** Returns `null` for a match this component can't usefully render --
 * e.g. an `ownerType: 'asset'` match whose owning `Asset` row was since
 * deleted (`search_catalog`'s own doc comment notes the same "since
 * deleted" possibility `catalog.ts`'s `/search` handles for the literal
 * path). */
function semanticMatchToItem(match: SearchCatalogMatch): DrawerItem | null {
  if (match.ownerType === 'asset') {
    if (!match.path) return null;
    return {
      key: `asset-${match.ownerId}`,
      ownerType: 'asset',
      assetId: match.ownerId,
      imagePath: match.path,
      label: match.label ?? assetLabel(match.path),
    };
  }
  if (match.ownerType === 'knowledge_entry') {
    return {
      key: `entry-${match.ownerId}`,
      ownerType: 'knowledge_entry',
      label: match.label ?? 'Untitled',
    };
  }
  return null;
}

export default function LibraryDrawer({ projectId, onReferenceAdded, searchCatalogMatches }: LibraryDrawerProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'browse' | 'literal' | 'semantic'>('browse');
  const [activeCategory, setActiveCategory] = useState<LibraryCategory>('assets');

  const [directories, setDirectories] = useState<CatalogDirectory[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [treeError, setTreeError] = useState('');

  const [filterQuery, setFilterQuery] = useState('');
  const [filterResults, setFilterResults] = useState<CatalogSearchResult[] | null>(null);
  const [filterLoading, setFilterLoading] = useState(false);

  const [addError, setAddError] = useState('');

  // Real catalog data, no `mockupStubData.ts` import anywhere in this
  // file -- fetched once on mount (catalog.ts's own R6 rationale: response
  // sizes are modest, no "preview then drill in" flow needs lazy tabs).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/catalog/tree');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setDirectories(Array.isArray(data.directories) ? data.directories : []);
      } catch (err) {
        if (!cancelled) setTreeError(err instanceof Error ? err.message : 'Failed to load the library');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/projects?view=all');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setProjects(Array.isArray(data.projects) ? data.projects : []);
      } catch {
        // The "projects" tab is a browsing convenience layered on an
        // already-existing read -- a failure here shouldn't block the
        // asset/example/style tabs, so it's swallowed rather than surfaced
        // via `treeError`.
        if (!cancelled) setProjects([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // SUC-015: a fresh `search_catalog` result always wins, opening the
  // drawer if it was closed -- including an empty match set, so the user
  // sees the broaden-your-query state directly rather than nothing
  // happening.
  useEffect(() => {
    if (searchCatalogMatches !== null) {
      setMode('semantic');
      setFilterQuery('');
      setOpen(true);
    }
  }, [searchCatalogMatches]);

  useEffect(() => {
    const q = filterQuery.trim();
    if (!q) {
      setMode((current) => (current === 'literal' ? 'browse' : current));
      setFilterResults(null);
      return;
    }
    let cancelled = false;
    setFilterLoading(true);
    setMode('literal');
    (async () => {
      try {
        const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setFilterResults(Array.isArray(data.results) ? data.results : []);
      } catch {
        if (!cancelled) setFilterResults([]);
      } finally {
        if (!cancelled) setFilterLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filterQuery]);

  const items: DrawerItem[] =
    mode === 'semantic'
      ? (searchCatalogMatches ?? [])
          .map(semanticMatchToItem)
          .filter((item): item is DrawerItem => item !== null)
      : mode === 'literal'
        ? (filterResults ?? []).map(searchResultToItem)
        : categoryItems(activeCategory, directories, projects);

  async function handleItemAdd(item: DrawerItem) {
    // Only real `Asset` items can become a `Reference` -- `Reference.assetId`
    // is a required FK (schema.prisma), so a knowledge-entry or project tile
    // double-click is a documented no-op (see module header).
    if (item.ownerType !== 'asset' || item.assetId === undefined) return;

    setAddError('');
    try {
      const res = await fetch(`/api/projects/${projectId}/references`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: item.assetId, role: 'style' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created = await res.json();
      onReferenceAdded({
        id: created.id,
        projectId,
        assetId: item.assetId,
        role: typeof created.role === 'string' ? created.role : 'style',
        asset: { id: item.assetId, path: item.imagePath ?? '' },
      });
      // Stakeholder round 5: double-click adds & closes.
      setOpen(false);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add reference');
    }
  }

  const emptyMessage =
    mode === 'semantic'
      ? 'No matching assets — try broadening your query.'
      : mode === 'literal'
        ? 'No results — try a different search.'
        : 'Nothing here yet.';

  return (
    <div
      data-testid="library-overlay"
      data-open={open}
      className={`absolute inset-y-0 left-0 z-30 flex w-[87.5%] flex-col border-r border-slate-300 bg-white shadow-2xl transition-transform duration-300 ${
        open ? 'translate-x-0' : 'pointer-events-none -translate-x-full'
      }`}
    >
      <div aria-hidden={!open} className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-slate-200 p-3">
          <input
            type="search"
            aria-label="Search library"
            placeholder="Search library…"
            value={filterQuery}
            onChange={(event) => setFilterQuery(event.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          />
          <p className="hidden flex-shrink-0 text-xs text-slate-400 sm:block">double-click adds &amp; closes</p>
          <button
            type="button"
            aria-label="Collapse library"
            onClick={() => setOpen(false)}
            className="flex-shrink-0 rounded border border-slate-300 px-2 py-1 text-sm text-slate-500 hover:bg-slate-50"
          >
            ×
          </button>
        </div>

        {mode === 'browse' && (
          <nav className="flex border-b border-slate-200" aria-label="Library categories">
            {CATEGORIES.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setActiveCategory(category)}
                aria-pressed={activeCategory === category}
                className={
                  activeCategory === category
                    ? 'flex-1 px-2 py-2 text-xs font-semibold text-indigo-600 border-b-2 border-indigo-600'
                    : 'flex-1 px-2 py-2 text-xs font-medium text-slate-500 border-b-2 border-transparent'
                }
              >
                {CATEGORY_LABELS[category]}
              </button>
            ))}
          </nav>
        )}

        {mode === 'semantic' && (
          <p className="border-b border-slate-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
            Showing what Claude found for your last request.
          </p>
        )}

        {treeError && (
          <p role="alert" className="px-3 py-2 text-xs text-red-600">
            {treeError}
          </p>
        )}
        {addError && (
          <p role="alert" className="px-3 py-2 text-xs text-red-600">
            {addError}
          </p>
        )}

        {filterLoading ? (
          <p className="p-4 text-sm text-slate-400">Searching…</p>
        ) : items.length === 0 ? (
          <p data-testid="library-empty" className="p-4 text-sm text-slate-400">
            {emptyMessage}
          </p>
        ) : (
          <ul
            data-testid="library-items"
            className="grid flex-1 grid-cols-2 content-start gap-2 overflow-y-auto p-2 lg:grid-cols-4"
          >
            {items.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  aria-label={item.ownerType === 'asset' ? `Add ${item.label}` : item.label}
                  onDoubleClick={() => void handleItemAdd(item)}
                  className="w-full rounded border border-slate-200 p-2 text-left hover:border-indigo-400"
                >
                  {item.imagePath ? (
                    <img
                      src={fileUrl(item.imagePath)}
                      alt=""
                      className="mb-2 aspect-video w-full rounded bg-slate-100 object-cover"
                    />
                  ) : (
                    <div aria-hidden="true" className="mb-2 aspect-video w-full rounded bg-slate-200" />
                  )}
                  <p className="truncate text-sm text-slate-800">{item.label}</p>
                  {item.detail && <p className="truncate text-xs text-slate-400">{item.detail}</p>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* The pull tab rides on the drawer's right edge, so it is the
          visible handle when closed and the close control when open. */}
      <button
        type="button"
        aria-label={open ? 'Close library' : 'Open library'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ writingMode: 'vertical-rl' }}
        className="pointer-events-auto absolute -right-8 top-1/4 rounded-r-lg bg-indigo-600 px-1.5 py-4 text-sm font-semibold tracking-wide text-white shadow-lg hover:bg-indigo-700"
      >
        {open ? '◂ Close' : 'Library ▸'}
      </button>
    </div>
  );
}
