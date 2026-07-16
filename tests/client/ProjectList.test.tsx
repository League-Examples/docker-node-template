import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
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
  patchProject?: (id: string, body: any) => { ok: boolean };
  deleteProject?: (id: string) => { ok: boolean };
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
    const projectIdMatch = url.match(/^\/api\/projects\/([^/]+)$/);
    if (projectIdMatch && init?.method === 'PATCH') {
      const id = projectIdMatch[1];
      const body = init.body ? JSON.parse(String(init.body)) : {};
      const result = handlers.patchProject ? handlers.patchProject(id, body) : { ok: true };
      return Promise.resolve({ ok: result.ok, status: result.ok ? 200 : 500, json: async () => ({ id, ...body }) } as Response);
    }
    if (projectIdMatch && init?.method === 'DELETE') {
      const id = projectIdMatch[1];
      const result = handlers.deleteProject ? handlers.deleteProject(id) : { ok: true };
      return Promise.resolve({ ok: result.ok, status: result.ok ? 200 : 500, json: async () => ({ id, deleted: true }) } as Response);
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

  it('shows the front even when only the back is accepted (front always wins)', async () => {
    stubFetch({
      projects: (view) =>
        view === 'mine'
          ? [
              {
                id: 3,
                title: 'Postcard C',
                status: 'active',
                detailsHeader: { outputType: 'Postcard' },
                iterations: [
                  { id: 30, seq: 21, imagePath: 'projects/3/iterations/21.png', accepted: false, role: 'front' },
                  { id: 31, seq: 22, imagePath: 'projects/3/iterations/22.png', accepted: true, role: 'back' },
                ],
              },
            ]
          : [],
    });
    renderPage();

    const card = (await screen.findByText('Postcard C')).closest('a')!;
    const img = card.querySelector('img');
    expect(img).toHaveAttribute('src', '/api/files/projects/3/iterations/21.png');
    expect(within(card).getByText('Front — Iteration 21')).toBeInTheDocument();
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

  it('within a front STREAM of many iterations (Sprint 005 OOP change, 2026-07-15: role is stream membership), the ACCEPTED one wins even when a newer front iteration is unaccepted', async () => {
    stubFetch({
      projects: (view) =>
        view === 'mine'
          ? [
              {
                id: 5,
                title: 'Postcard E',
                status: 'active',
                detailsHeader: { outputType: 'Postcard' },
                iterations: [
                  { id: 50, seq: 1, imagePath: 'projects/5/iterations/1.png', accepted: true, role: 'front' },
                  { id: 51, seq: 2, imagePath: 'projects/5/iterations/2.png', accepted: false, role: 'front' },
                  { id: 52, seq: 3, imagePath: 'projects/5/iterations/3.png', accepted: false, role: 'front' },
                ],
              },
            ]
          : [],
    });
    renderPage();

    const card = (await screen.findByText('Postcard E')).closest('a')!;
    // The whole front stream shares role: 'front' now -- only the
    // ACCEPTED one (seq 1, not the most recent seq 3) is the hero.
    expect(card.querySelector('img')).toHaveAttribute('src', '/api/files/projects/5/iterations/1.png');
    expect(within(card).getByText('Front — Iteration 1 (accepted)')).toBeInTheDocument();
  });

  it('within a front stream with nothing accepted yet, falls back to the most recent front-stream iteration (never the back)', async () => {
    stubFetch({
      projects: (view) =>
        view === 'mine'
          ? [
              {
                id: 6,
                title: 'Postcard F',
                status: 'active',
                detailsHeader: { outputType: 'Postcard' },
                iterations: [
                  { id: 60, seq: 1, imagePath: 'projects/6/iterations/1.png', accepted: false, role: 'front' },
                  { id: 61, seq: 2, imagePath: 'projects/6/iterations/2.png', accepted: false, role: 'front' },
                  { id: 62, seq: 3, imagePath: 'projects/6/iterations/3.png', accepted: true, role: 'back' },
                ],
              },
            ]
          : [],
    });
    renderPage();

    const card = (await screen.findByText('Postcard F')).closest('a')!;
    expect(card.querySelector('img')).toHaveAttribute('src', '/api/files/projects/6/iterations/2.png');
    expect(within(card).getByText('Front — Iteration 2')).toBeInTheDocument();
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

/** Stubs `img` as having rendered at `widthPx` wide, then fires its `load`
 * event -- jsdom performs no real layout, so `HeroImage`'s
 * `useMeasuredWidth`-driven `getBoundingClientRect()` measurement has to be
 * stubbed by hand, mirroring `ProjectDetailOutputPane.test.tsx`'s own
 * `measureImage` helper for the exact same reason. Takes the element
 * directly (via `card.querySelector('img')`, as the hero-rule tests above
 * already do) rather than `getByRole('img')` -- the hero `<img>` has
 * `alt=""`, which gives it ARIA role `presentation`, not `img`. */
function measureImage(img: HTMLImageElement, widthPx: number, heightPx = widthPx / 1.5) {
  Object.defineProperty(img, 'getBoundingClientRect', {
    value: () => ({ width: widthPx, height: heightPx, top: 0, left: 0, right: widthPx, bottom: heightPx, x: 0, y: 0, toJSON() {} }),
    configurable: true,
  });
  fireEvent.load(img);
  return img;
}

describe('ProjectList hero-card rendered-text overlay (OOP change, 2026-07-15)', () => {
  it('overlays front_regions text over the hero image when the hero iteration is role: "front"', async () => {
    stubFetch({
      projects: (view) =>
        view === 'mine'
          ? [
              {
                id: 1,
                title: 'Postcard With Text',
                status: 'active',
                owner: { id: 1, email: 'me@x.org', displayName: null },
                iterations: [
                  { id: 10, seq: 1, imagePath: 'projects/1/iterations/1.png', accepted: true, role: 'front' },
                ],
                postcardContent: {
                  front_regions: [
                    {
                      name: 'headline',
                      label: 'Headline',
                      style: '',
                      text: 'HELLO POSTCARD',
                      position: { top: '1.0in', left: '0.5in', width: '3.4in' },
                      font: { family: 'Arial, sans-serif', size: '24px' },
                    },
                  ],
                },
              },
            ]
          : [],
    });
    renderPage();

    const card = (await screen.findByText('Postcard With Text')).closest('a')!;
    measureImage(card.querySelector('img')!, 600);

    const overlay = await screen.findByTestId('postcard-overlay');
    expect(within(card).getByTestId('overlay-region-text-headline')).toHaveTextContent('HELLO POSTCARD');
    expect(card.contains(overlay)).toBe(true);

    // The card's own navigation target is unaffected by the overlay.
    expect(card).toHaveAttribute('href', '/projects/1');
  });

  it('renders a bare image (no overlay) when the project has no saved postcard content', async () => {
    stubFetch({
      projects: (view) =>
        view === 'mine'
          ? [
              {
                id: 2,
                title: 'Postcard Without Content',
                status: 'active',
                owner: { id: 1, email: 'me@x.org', displayName: null },
                iterations: [
                  { id: 20, seq: 1, imagePath: 'projects/2/iterations/1.png', accepted: true, role: 'front' },
                ],
                postcardContent: null,
              },
            ]
          : [],
    });
    renderPage();

    const card = (await screen.findByText('Postcard Without Content')).closest('a')!;
    measureImage(card.querySelector('img')!, 600);

    expect(within(card).queryByTestId('postcard-overlay')).not.toBeInTheDocument();
  });

  it('renders a bare image (no overlay) when the hero iteration has no role', async () => {
    stubFetch({
      projects: (view) =>
        view === 'mine'
          ? [
              {
                id: 3,
                title: 'Unmarked Project',
                status: 'active',
                owner: { id: 1, email: 'me@x.org', displayName: null },
                iterations: [
                  { id: 30, seq: 1, imagePath: 'projects/3/iterations/1.png', accepted: true, role: null },
                ],
                postcardContent: {
                  front_regions: [
                    {
                      name: 'headline',
                      label: 'Headline',
                      style: '',
                      text: 'SHOULD NOT SHOW',
                      position: { top: '1.0in', left: '0.5in', width: '3.4in' },
                      font: { family: 'Arial, sans-serif', size: '24px' },
                    },
                  ],
                },
              },
            ]
          : [],
    });
    renderPage();

    const card = (await screen.findByText('Unmarked Project')).closest('a')!;
    measureImage(card.querySelector('img')!, 600);

    expect(within(card).queryByTestId('postcard-overlay')).not.toBeInTheDocument();
  });

  it('does not interfere with the selection checkbox (still toggles, still does not navigate)', async () => {
    stubFetch({
      projects: (view) =>
        view === 'mine'
          ? [
              {
                id: 4,
                title: 'Overlaid Selectable',
                status: 'active',
                owner: { id: 1, email: 'me@x.org', displayName: null },
                iterations: [
                  { id: 40, seq: 1, imagePath: 'projects/4/iterations/1.png', accepted: true, role: 'front' },
                ],
                postcardContent: {
                  front_regions: [
                    {
                      name: 'headline',
                      label: 'Headline',
                      style: '',
                      text: 'CHECKBOX TEST',
                      position: { top: '1.0in', left: '0.5in', width: '3.4in' },
                      font: { family: 'Arial, sans-serif', size: '24px' },
                    },
                  ],
                },
              },
            ]
          : [],
    });
    renderPage();

    const selectableCard = (await screen.findByText('Overlaid Selectable')).closest('a')!;
    measureImage(selectableCard.querySelector('img')!, 600);
    await screen.findByTestId('postcard-overlay');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Overlaid Selectable' }));

    expect(screen.getByRole('checkbox', { name: 'Select Overlaid Selectable' })).toBeChecked();
    // Selecting never navigates -- the detail stub route text never appears.
    expect(screen.queryByText('Project Detail 4')).not.toBeInTheDocument();
    expect(screen.getByText('Overlaid Selectable')).toBeInTheDocument();
  });
});

describe('ProjectList new-project flow (OOP follow-up, 2026-07-16: name + description modal)', () => {
  it('"New project" opens a modal instead of creating immediately', async () => {
    stubFetch({ projects: () => [] });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'New project' }));

    expect(screen.getByRole('dialog', { name: 'New project' })).toBeInTheDocument();
  });

  it('Create is disabled until a name is entered', async () => {
    stubFetch({ projects: () => [] });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'New project' }));

    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Spring Postcard' } });
    expect(screen.getByRole('button', { name: 'Create' })).not.toBeDisabled();
  });

  it('Create POSTs { title, description } and navigates to /projects/:id', async () => {
    const fetchMock = stubFetch({
      projects: () => [],
      createProject: () => ({ id: 42, title: 'Spring Postcard' }),
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Spring Postcard' } });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'A postcard announcing the spring open house.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await screen.findByText('Project Detail 42');

    const postCall = fetchMock.mock.calls.find(
      ([url, init]: [string, RequestInit | undefined]) => url === '/api/projects' && init?.method === 'POST',
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse(String(postCall![1]!.body));
    expect(body).toEqual({ title: 'Spring Postcard', description: 'A postcard announcing the spring open house.' });
  });

  it('Enter in the name field submits, same as clicking Create', async () => {
    const fetchMock = stubFetch({
      projects: () => [],
      createProject: () => ({ id: 43, title: 'Enter Submit' }),
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Enter Submit' } });
    fireEvent.keyDown(screen.getByLabelText('Project name'), { key: 'Enter' });

    await screen.findByText('Project Detail 43');
    expect(fetchMock).toHaveBeenCalledWith('/api/projects', expect.objectContaining({ method: 'POST' }));
  });

  it('Cancel closes the modal without POSTing', async () => {
    const fetchMock = stubFetch({ projects: () => [] });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Abandoned' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'New project' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url, init]: [string, RequestInit | undefined]) => url === '/api/projects' && init?.method === 'POST')).toBe(
      false,
    );
  });

  it('Escape closes the modal without POSTing', async () => {
    const fetchMock = stubFetch({ projects: () => [] });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'New project' }), { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'New project' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url, init]: [string, RequestInit | undefined]) => url === '/api/projects' && init?.method === 'POST')).toBe(
      false,
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

describe('ProjectList bulk select/archive/delete (OOP follow-up, 2026-07-15)', () => {
  function twoProjects() {
    return [
      { id: 1, title: 'Postcard One', status: 'active', owner: { id: 1, email: 'me@x.org', displayName: null }, iterations: [] },
      { id: 2, title: 'Postcard Two', status: 'active', owner: { id: 1, email: 'me@x.org', displayName: null }, iterations: [] },
    ];
  }

  it('selecting a card shows the action bar with a running count, and Clear dismisses it', async () => {
    stubFetch({ projects: (view) => (view === 'mine' ? twoProjects() : []) });
    renderPage();

    await screen.findByText('Postcard One');
    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Postcard One' }));
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Postcard Two' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
  });

  it('clicking the checkbox selects the card without navigating into the project', async () => {
    stubFetch({ projects: (view) => (view === 'mine' ? twoProjects() : []) });
    renderPage();

    await screen.findByText('Postcard One');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Postcard One' }));

    expect(screen.getByRole('checkbox', { name: 'Select Postcard One' })).toBeChecked();
    expect(screen.queryByText('Project Detail 1')).not.toBeInTheDocument();
    expect(screen.getByText('Postcard One')).toBeInTheDocument();
  });

  it('Archive PATCHes each selected project to archived and refetches the current view', async () => {
    const fetchMock = stubFetch({
      projects: (view) => (view === 'mine' ? twoProjects() : []),
      patchProject: () => ({ ok: true }),
    });
    renderPage();

    await screen.findByText('Postcard One');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Postcard One' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Postcard Two' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Archive selected projects' }));

    await waitFor(() => expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument());

    const patchCalls = fetchMock.mock.calls.filter(
      ([, init]: [string, RequestInit | undefined]) => init?.method === 'PATCH',
    );
    expect(patchCalls).toHaveLength(2);
    const patchedIds = patchCalls.map(([url]: [string, RequestInit | undefined]) => url).sort();
    expect(patchedIds).toEqual(['/api/projects/1', '/api/projects/2']);
    expect(JSON.parse(String(patchCalls[0][1]!.body))).toEqual({ status: 'archived' });

    // Refetches the current (My) view after the bulk action so the list
    // reflects the change.
    const getMineCalls = fetchMock.mock.calls.filter(([url]: [string]) => url === '/api/projects?view=mine');
    expect(getMineCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('Delete opens a confirmation popup; confirming DELETEs each selected project and refetches', async () => {
    const fetchMock = stubFetch({
      projects: (view) => (view === 'mine' ? twoProjects() : []),
      deleteProject: () => ({ ok: true }),
    });
    renderPage();

    await screen.findByText('Postcard One');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Postcard One' }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete selected projects' }));
    await screen.findByText("Delete 1 project? This can't be undone.");

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete selected projects' }));

    await waitFor(() => expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument());

    const deleteCalls = fetchMock.mock.calls.filter(
      ([, init]: [string, RequestInit | undefined]) => init?.method === 'DELETE',
    );
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0][0]).toBe('/api/projects/1');

    const getMineCalls = fetchMock.mock.calls.filter(([url]: [string]) => url === '/api/projects?view=mine');
    expect(getMineCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('Cancel on the delete confirmation makes no request and preserves the selection', async () => {
    const fetchMock = stubFetch({ projects: (view) => (view === 'mine' ? twoProjects() : []) });
    renderPage();

    await screen.findByText('Postcard One');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Postcard One' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected projects' }));
    await screen.findByText("Delete 1 project? This can't be undone.");

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText("Delete 1 project? This can't be undone.")).not.toBeInTheDocument();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    const deleteCalls = fetchMock.mock.calls.filter(
      ([, init]: [string, RequestInit | undefined]) => init?.method === 'DELETE',
    );
    expect(deleteCalls).toHaveLength(0);
  });

  it('Archive view offers Restore (not Archive) for the bulk action', async () => {
    const fetchMock = stubFetch({
      projects: (view) =>
        view === 'archive'
          ? [{ id: 7, title: 'Old Flyer', status: 'archived', owner: { id: 1, email: 'me@x.org', displayName: null }, iterations: [] }]
          : [],
      patchProject: () => ({ ok: true }),
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Archive' })); // the view-switch button
    await screen.findByText('Old Flyer');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Old Flyer' }));
    expect(screen.getByRole('button', { name: 'Restore selected projects' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive selected projects' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Restore selected projects' }));
    await waitFor(() => expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument());

    const patchCalls = fetchMock.mock.calls.filter(
      ([, init]: [string, RequestInit | undefined]) => init?.method === 'PATCH',
    );
    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0][0]).toBe('/api/projects/7');
    expect(JSON.parse(String(patchCalls[0][1]!.body))).toEqual({ status: 'active' });
  });

  it('Library view never shows a selection checkbox', async () => {
    stubFetch({
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
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    await screen.findByText('logo robot');

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('switching views clears the selection', async () => {
    stubFetch({
      projects: (view) => (view === 'mine' ? twoProjects() : []),
    });
    renderPage();

    await screen.findByText('Postcard One');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Postcard One' }));
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All projects' }));

    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
    await screen.findByText('No projects yet.');
  });
});
