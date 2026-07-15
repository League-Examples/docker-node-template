import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import LibraryDrawer from '../../client/src/pages/ProjectDetail/LibraryDrawer';
import type { ReferenceDTO, SearchCatalogMatch } from '../../client/src/pages/ProjectDetail/types';

/**
 * Coverage for `client/src/pages/ProjectDetail/LibraryDrawer.tsx` (ticket
 * 010): the collapsible pull-out drawer promoted from
 * `pages/mockups/MockupLeftBrowser.tsx` + `MockupMain.tsx`'s wrapper --
 * real catalog data (no `mockupStubData.ts`), the literal FTS5 filter bar,
 * the SUC-015 conversational/semantic filter (driven by a prop, not a
 * second SSE connection -- see the component's own header comment), the
 * round-5 double-click-adds-and-closes regression, and the UC-002/UC-014
 * empty states.
 */

function catalogTreeFixture() {
  return {
    directories: [
      {
        id: 1,
        parentId: null,
        path: 'assets/logos',
        name: 'logos',
        kind: 'collection',
        collections: [
          {
            id: 10,
            name: 'logos',
            kind: 'stock-art',
            assets: [
              { id: 100, path: 'assets/logo-robot.png', description: 'League robot logo' },
            ],
          },
        ],
        knowledgeEntries: [],
      },
      {
        id: 2,
        parentId: null,
        path: 'assets/prior-art',
        name: 'prior-art',
        kind: 'collection',
        collections: [
          {
            id: 11,
            name: 'prior-art',
            kind: 'prior-art',
            assets: [{ id: 101, path: 'assets/prior-art-scene.jpg', description: 'Pop-art scene' }],
          },
        ],
        knowledgeEntries: [],
      },
      {
        id: 3,
        parentId: null,
        path: 'knowledge/styles',
        name: 'styles',
        kind: 'knowledge-category',
        collections: [],
        knowledgeEntries: [
          { id: 200, kind: 'style', name: 'Pop Art', bodyText: 'Ben-Day dots, flat primary palette' },
          { id: 201, kind: 'palette', name: 'Warm palette', bodyText: 'not a style entry' },
        ],
      },
    ],
  };
}

/** A general-purpose `fetch` stub for `LibraryDrawer` in isolation.
 * `overrides` lets individual tests swap in custom handlers (e.g. a
 * literal-search response, or a references POST) without re-implementing
 * the whole switch. */
function stubFetch(overrides: Record<string, (init?: RequestInit) => Response | Promise<Response>> = {}) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (overrides[url]) return Promise.resolve(overrides[url](init));
    if (url === '/api/catalog/tree') {
      return Promise.resolve({ ok: true, json: async () => catalogTreeFixture() } as Response);
    }
    if (url === '/api/projects?view=all') {
      return Promise.resolve({ ok: true, json: async () => ({ projects: [] }) } as Response);
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LibraryDrawer -- pull-out tab open/close', () => {
  it('is closed by default and opens/closes via the vertical pull tab', async () => {
    stubFetch();
    render(<LibraryDrawer projectId={7} onReferenceAdded={vi.fn()} searchCatalogMatches={null} />);

    expect(screen.getByTestId('library-overlay')).toHaveAttribute('data-open', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Open library' }));
    expect(screen.getByTestId('library-overlay')).toHaveAttribute('data-open', 'true');
    // Let the mount-time catalog/projects fetches settle before the test
    // ends, so no state update lands outside act().
    await screen.findByTestId('library-items');

    fireEvent.click(screen.getByRole('button', { name: 'Close library' }));
    expect(screen.getByTestId('library-overlay')).toHaveAttribute('data-open', 'false');
  });
});

describe('LibraryDrawer -- real catalog data (SUC-002)', () => {
  it('renders real assets with real thumbnails via GET /api/files/*, no mockupStubData', async () => {
    stubFetch();
    render(<LibraryDrawer projectId={7} onReferenceAdded={vi.fn()} searchCatalogMatches={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open library' }));

    const items = await screen.findByTestId('library-items');
    // `alt=""` gives these thumbnails an implicit `presentation` role (same
    // reason `ProjectDetail.test.tsx`'s reference-strip test uses
    // `querySelector` rather than `getByRole('img')`).
    const img = items.querySelector('img');
    expect(img).toHaveAttribute('src', '/api/files/assets/logo-robot.png');
    expect(within(items).getByText('logo robot')).toBeInTheDocument();
  });

  it('splits assets/prior-art into the Examples tab and knowledge/styles style entries into the Styles tab', async () => {
    stubFetch();
    render(<LibraryDrawer projectId={7} onReferenceAdded={vi.fn()} searchCatalogMatches={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open library' }));
    await screen.findByTestId('library-items');

    fireEvent.click(screen.getByRole('button', { name: 'Examples' }));
    expect(await screen.findByText('prior art scene')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Styles' }));
    expect(await screen.findByText('Pop Art')).toBeInTheDocument();
    // Only the kind: 'style' entry shows -- the kind: 'palette' entry does not.
    expect(screen.queryByText('Warm palette')).not.toBeInTheDocument();
  });

  it('renders the empty-catalog state without error when there are no assets at all (UC-002 E1)', async () => {
    const fn = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/catalog/tree') return Promise.resolve({ ok: true, json: async () => ({ directories: [] }) } as Response);
      if (url === '/api/projects?view=all') return Promise.resolve({ ok: true, json: async () => ({ projects: [] }) } as Response);
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
    });
    vi.stubGlobal('fetch', fn);

    render(<LibraryDrawer projectId={7} onReferenceAdded={vi.fn()} searchCatalogMatches={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open library' }));

    expect(await screen.findByTestId('library-empty')).toHaveTextContent('Nothing here yet.');
  });
});

describe('LibraryDrawer -- literal FTS5 filter bar (UC-014 secondary path)', () => {
  it('narrows results via GET /api/catalog/search?q=', async () => {
    const fetchMock = stubFetch({
      '/api/catalog/search?q=robot': () =>
        ({
          ok: true,
          json: async () => ({
            results: [{ ownerType: 'asset', id: 100, path: 'assets/logo-robot.png', description: 'League robot logo' }],
          }),
        }) as Response,
    });

    render(<LibraryDrawer projectId={7} onReferenceAdded={vi.fn()} searchCatalogMatches={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open library' }));
    await screen.findByTestId('library-items');

    fireEvent.change(screen.getByLabelText('Search library'), { target: { value: 'robot' } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/catalog/search?q=robot');
    });
    expect(await screen.findByText('logo robot')).toBeInTheDocument();
    // The category tabs are hidden while a literal filter is active.
    expect(screen.queryByRole('navigation', { name: 'Library categories' })).not.toBeInTheDocument();
  });
});

describe('LibraryDrawer -- double-click adds & auto-closes (SUC-003, round-5 regression)', () => {
  it('double-clicking an asset POSTs a real Reference and closes the drawer', async () => {
    const onReferenceAdded = vi.fn();
    const fetchMock = stubFetch({
      '/api/projects/7/references': () =>
        ({ ok: true, json: async () => ({ id: 500, projectId: 7, assetId: 100, role: 'style' }) }) as Response,
    });

    render(<LibraryDrawer projectId={7} onReferenceAdded={onReferenceAdded} searchCatalogMatches={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open library' }));
    await screen.findByTestId('library-items');

    fireEvent.doubleClick(screen.getByRole('button', { name: 'Add logo robot' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/7/references',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assetId: 100, role: 'style' }),
        }),
      );
    });

    await waitFor(() => {
      expect(onReferenceAdded).toHaveBeenCalledWith({
        id: 500,
        projectId: 7,
        assetId: 100,
        role: 'style',
        asset: { id: 100, path: 'assets/logo-robot.png' },
      } satisfies ReferenceDTO);
    });

    await waitFor(() => expect(screen.getByTestId('library-overlay')).toHaveAttribute('data-open', 'false'));
  });

  it('double-clicking a non-asset item (a style knowledge entry) is a no-op -- no POST, drawer stays open', async () => {
    const fetchMock = stubFetch();
    render(<LibraryDrawer projectId={7} onReferenceAdded={vi.fn()} searchCatalogMatches={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open library' }));
    await screen.findByTestId('library-items');

    fireEvent.click(screen.getByRole('button', { name: 'Styles' }));
    await screen.findByText('Pop Art');
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Pop Art' }));

    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/projects/7/references')).toBe(false);
    expect(screen.getByTestId('library-overlay')).toHaveAttribute('data-open', 'true');
  });
});

describe('LibraryDrawer -- conversational/semantic filter (SUC-015)', () => {
  const matches: SearchCatalogMatch[] = [
    { ownerType: 'asset', ownerId: 100, matchedVia: ['vector', 'keyword'], score: 0.9, path: 'assets/logo-robot.png', label: 'a robot logo' },
  ];

  it('a fresh search_catalog result opens the drawer and shows only the matched items', async () => {
    stubFetch();
    const { rerender } = render(<LibraryDrawer projectId={7} onReferenceAdded={vi.fn()} searchCatalogMatches={null} />);

    expect(screen.getByTestId('library-overlay')).toHaveAttribute('data-open', 'false');

    rerender(<LibraryDrawer projectId={7} onReferenceAdded={vi.fn()} searchCatalogMatches={matches} />);

    await waitFor(() => expect(screen.getByTestId('library-overlay')).toHaveAttribute('data-open', 'true'));
    expect(await screen.findByText('a robot logo')).toBeInTheDocument();
  });

  it('an empty match set shows the broaden-your-query state, not an error (UC-014 E1)', async () => {
    stubFetch();
    const { rerender } = render(<LibraryDrawer projectId={7} onReferenceAdded={vi.fn()} searchCatalogMatches={null} />);

    rerender(<LibraryDrawer projectId={7} onReferenceAdded={vi.fn()} searchCatalogMatches={[]} />);

    await waitFor(() => expect(screen.getByTestId('library-overlay')).toHaveAttribute('data-open', 'true'));
    expect(await screen.findByTestId('library-empty')).toHaveTextContent(/broadening your query/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
