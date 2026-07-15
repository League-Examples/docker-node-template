import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom';
import ProjectList from '../../client/src/pages/ProjectList';

/**
 * Coverage for `client/src/pages/ProjectList.tsx` (ticket 008): the
 * My/All/Archive/Library views, the SUC-010 hero-image selection rule
 * (accepted, front-over-back for postcards, fallback to last), the
 * new-project flow, and the SUC-011 library-asset-to-project flow.
 * Mirrors `MockupProjects.test.tsx`'s scenarios but against real,
 * mocked-network data instead of static stub data.
 */

function ProjectDetailStub() {
  const { id } = useParams<{ id: string }>();
  return <p>Project Detail {id}</p>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<ProjectList />} />
        <Route path="/projects/:id" element={<ProjectDetailStub />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** A minimal fetch mock: routes by URL/method, matching this app's
 * existing fetch conventions (see `UsersPanel.tsx`) rather than a mocking
 * library -- no live network is ever hit. */
function stubFetch(handlers: {
  projects?: (view: string) => unknown[];
  tree?: () => unknown;
  createProject?: (body: any) => unknown;
}) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/projects?view=')) {
      const view = url.split('view=')[1];
      const projects = handlers.projects ? handlers.projects(view) : [];
      return Promise.resolve({ ok: true, json: async () => ({ projects }) } as Response);
    }
    if (url === '/api/catalog/tree') {
      const tree = handlers.tree ? handlers.tree() : { directories: [] };
      return Promise.resolve({ ok: true, json: async () => tree } as Response);
    }
    if (url === '/api/projects' && init?.method === 'POST') {
      const body = init.body ? JSON.parse(String(init.body)) : {};
      const created = handlers.createProject ? handlers.createProject(body) : { id: 1 };
      return Promise.resolve({ ok: true, json: async () => created } as Response);
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ProjectList views', () => {
  it('defaults to My projects and fetches GET /api/projects?view=mine', async () => {
    const fetchMock = stubFetch({
      projects: (view) =>
        view === 'mine'
          ? [{ id: 1, title: 'My Postcard', status: 'active', owner: { id: 1, email: 'me@x.org', displayName: null }, iterations: [] }]
          : [],
    });
    renderPage();

    expect(screen.getByRole('button', { name: 'My projects' })).toHaveAttribute('aria-pressed', 'true');
    await screen.findByText('My Postcard');
    expect(fetchMock).toHaveBeenCalledWith('/api/projects?view=mine');
  });

  it('All projects fetches view=all and renders every returned project', async () => {
    stubFetch({
      projects: (view) =>
        view === 'all'
          ? [
              { id: 1, title: 'Mine', status: 'active', owner: { id: 1, email: 'me@x.org', displayName: null }, iterations: [] },
              { id: 2, title: "Someone else's", status: 'active', owner: { id: 2, email: 'other@x.org', displayName: null }, iterations: [] },
            ]
          : [],
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'All projects' }));
    expect(screen.getByRole('button', { name: 'All projects' })).toHaveAttribute('aria-pressed', 'true');

    await screen.findByText('Mine');
    expect(screen.getByText("Someone else's")).toBeInTheDocument();
    expect(screen.getByText('other@x.org')).toBeInTheDocument();
  });

  it('Archive fetches view=archive and renders only archived projects', async () => {
    stubFetch({
      projects: (view) =>
        view === 'archive'
          ? [{ id: 3, title: 'Old Flyer', status: 'archived', owner: { id: 1, email: 'me@x.org', displayName: null }, iterations: [] }]
          : [],
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await screen.findByText('Old Flyer');
  });

  it('Library view fetches GET /api/catalog/tree and shows assets, not project cards', async () => {
    const fetchMock = stubFetch({
      projects: () => [{ id: 1, title: 'A Project', status: 'active', iterations: [] }],
      tree: () => ({
        directories: [
          {
            id: 1,
            parentId: null,
            path: 'assets',
            name: 'assets',
            kind: 'collection',
            collections: [
              {
                id: 1,
                name: 'stock-art',
                kind: 'stock-art',
                assets: [{ id: 5, path: 'assets/stock-art/logo-robot.png', description: 'League robot logo' }],
              },
            ],
          },
        ],
      }),
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    expect(screen.getByRole('button', { name: 'Library' })).toHaveAttribute('aria-pressed', 'true');

    await screen.findByText('logo robot');
    expect(screen.queryByText('A Project')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/catalog/tree');
  });
});

describe('ProjectList hero-image selection rule (SUC-010)', () => {
  it('accepted+front wins over accepted+back, even when back is more recent', async () => {
    stubFetch({
      projects: (view) =>
        view === 'mine'
          ? [
              {
                id: 1,
                title: 'Postcard A',
                status: 'active',
                detailsHeader: { outputType: 'Postcard' },
                iterations: [
                  { id: 10, seq: 1, imagePath: 'projects/1/iterations/1.png', accepted: true, role: 'front' },
                  { id: 11, seq: 5, imagePath: 'projects/1/iterations/5.png', accepted: true, role: 'back' },
                ],
              },
            ]
          : [],
    });
    renderPage();

    const card = (await screen.findByText('Postcard A')).closest('a')!;
    expect(within(card).getByText('Front — Iteration 1 (accepted)')).toBeInTheDocument();
    const img = card.querySelector('img');
    expect(img).toHaveAttribute('src', '/api/files/projects/1/iterations/1.png');
  });

  it('falls back to the last iteration overall when nothing is accepted', async () => {
    stubFetch({
      projects: (view) =>
        view === 'mine'
          ? [
              {
                id: 2,
                title: 'Poster B',
                status: 'active',
                iterations: [
                  { id: 20, seq: 1, imagePath: 'projects/2/iterations/1.png', accepted: false, role: null },
                  { id: 21, seq: 3, imagePath: 'projects/2/iterations/3.png', accepted: false, role: null },
                ],
              },
            ]
          : [],
    });
    renderPage();

    const card = (await screen.findByText('Poster B')).closest('a')!;
    expect(within(card).getByText('Iteration 3 (last — nothing accepted)')).toBeInTheDocument();
    expect(card.querySelector('img')).toHaveAttribute('src', '/api/files/projects/2/iterations/3.png');
  });

  it('uses a single accepted iteration with no role directly', async () => {
    stubFetch({
      projects: (view) =>
        view === 'mine'
          ? [
              {
                id: 3,
                title: 'Logo C',
                status: 'active',
                iterations: [
                  { id: 30, seq: 1, imagePath: 'projects/3/iterations/1.png', accepted: true, role: null },
                ],
              },
            ]
          : [],
    });
    renderPage();

    const card = (await screen.findByText('Logo C')).closest('a')!;
    expect(within(card).getByText('Iteration 1 (accepted)')).toBeInTheDocument();
    expect(card.querySelector('img')).toHaveAttribute('src', '/api/files/projects/3/iterations/1.png');
  });
});

describe('ProjectList new-project flow', () => {
  it('"New project" button POSTs /api/projects and navigates to /projects/:id', async () => {
    const fetchMock = stubFetch({
      projects: () => [],
      createProject: () => ({ id: 42, title: 'Untitled project' }),
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'New project' }));

    await screen.findByText('Project Detail 42');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('ProjectList library-asset-to-project flow (SUC-011)', () => {
  it('clicking a Library asset POSTs /api/projects with sourceAssetId and navigates into it', async () => {
    const fetchMock = stubFetch({
      projects: () => [],
      tree: () => ({
        directories: [
          {
            id: 1,
            parentId: null,
            path: 'assets',
            name: 'assets',
            kind: 'collection',
            collections: [
              {
                id: 1,
                name: 'stock-art',
                kind: 'stock-art',
                assets: [{ id: 5, path: 'assets/stock-art/logo-robot.png' }],
              },
            ],
          },
        ],
      }),
      createProject: (body) => ({ id: 99, title: body.title, sourceAssetId: body.sourceAssetId }),
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    const assetButton = await screen.findByRole('button', { name: /create a project for logo robot/i });
    fireEvent.click(assetButton);

    await screen.findByText('Project Detail 99');

    const postCall = fetchMock.mock.calls.find(
      ([url, init]: [string, RequestInit | undefined]) => url === '/api/projects' && init?.method === 'POST',
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse(String(postCall![1]!.body));
    expect(body.sourceAssetId).toBe(5);
  });
});
