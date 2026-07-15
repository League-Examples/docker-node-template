import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProjectDetail from '../../client/src/pages/ProjectDetail';

/**
 * Coverage for `client/src/pages/ProjectDetail/index.tsx` (ticket 005-009):
 * the page-level wiring around `OutputPane` + `ChatPanel` -- a single
 * `GET /api/projects/:id` rehydrates iterations, references, and chat
 * history in one round trip (SUC-005), the reference strip renders each
 * attached reference as a small thumbnail with a remove control, and a
 * fresh mount (simulating a reload) re-fetches and shows persisted state.
 */

function projectFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    title: 'Spring Open House Flyer',
    status: 'active',
    iterations: [
      { id: 1, projectId: 7, seq: 1, imagePath: 'projects/7/iterations/1.png', accepted: true, role: 'front' },
    ],
    references: [
      { id: 100, projectId: 7, assetId: 5, role: 'style', asset: { id: 5, path: 'assets/logo-robot.png' } },
    ],
    chatMessages: [
      { id: 1, projectId: 7, role: 'assistant', content: 'Hi there', createdAt: '2026-07-14T00:00:00Z' },
    ],
    ...overrides,
  };
}

/** Ticket 010 mounts `LibraryDrawer` as a sibling of `OutputPane`/
 * `ChatPanel`, so every render of the real `ProjectDetail` page now also
 * fires `GET /api/catalog/tree` and `GET /api/projects?view=all` on mount
 * (the drawer's own two background loads). Stubbed here with an empty
 * catalog/project list by default -- these tests are about the page-level
 * `GET /api/projects/:id` rehydration and reference strip, not the
 * drawer's own contents (covered by `ProjectDetailLibraryDrawer.test.tsx`). */
function stubFetch(project: unknown) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/projects/7' && (!init || !init.method)) {
      return Promise.resolve({ ok: true, json: async () => project } as Response);
    }
    if (url.startsWith('/api/projects/7/references/') && init?.method === 'DELETE') {
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    }
    if (url === '/api/catalog/tree') {
      return Promise.resolve({ ok: true, json: async () => ({ directories: [] }) } as Response);
    }
    if (url === '/api/projects?view=all') {
      return Promise.resolve({ ok: true, json: async () => ({ projects: [] }) } as Response);
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/projects/7']}>
      <Routes>
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/" element={<p>Project list</p>} />
        <Route path="/projects/:id/postcard" element={<p>Postcard editor</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ProjectDetail -- single GET rehydrates everything (SUC-005)', () => {
  it('fetches GET /api/projects/:id once and renders the output pane, chat history, and references', async () => {
    const fetchMock = stubFetch(projectFixture());
    renderPage();

    await screen.findByText('Spring Open House Flyer');
    expect(screen.getByText('Hi there')).toBeInTheDocument();
    expect(screen.getByTestId('project-references')).toBeInTheDocument();

    const getCalls = fetchMock.mock.calls.filter(([url, init]) => url === '/api/projects/7' && !init?.method);
    expect(getCalls).toHaveLength(1);
  });

  it('shows a loading state, then an error state on a failed fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    renderPage();
    expect(screen.getByText('Loading project…')).toBeInTheDocument();
    await screen.findByText('HTTP 500');
  });
});

describe('ProjectDetail -- reference strip render + remove', () => {
  it('renders each attached reference as a small thumbnail via GET /api/files/*', async () => {
    stubFetch(projectFixture());
    renderPage();

    await screen.findByTestId('project-references');
    const img = screen.getByTestId('project-references').querySelector('img')!;
    expect(img).toHaveAttribute('src', '/api/files/assets/logo-robot.png');
  });

  it('removing a reference calls DELETE and removes the chip', async () => {
    const fetchMock = stubFetch(projectFixture());
    renderPage();

    await screen.findByTestId('project-references');
    const removeButton = screen.getByRole('button', { name: /remove/i });
    fireEvent.click(removeButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/projects/7/references/100', { method: 'DELETE' });
    });
    await waitFor(() => expect(screen.queryByTestId('project-references')).not.toBeInTheDocument());
  });

  it('renders no reference strip when the project has no references', async () => {
    stubFetch(projectFixture({ references: [] }));
    renderPage();

    await screen.findByText('Spring Open House Flyer');
    expect(screen.queryByTestId('project-references')).not.toBeInTheDocument();
  });
});

describe('ProjectDetail -- reload persists accepted/role state (via OutputPane props)', () => {
  it('a fresh mount re-fetches and reflects the currently persisted accepted/role marks', async () => {
    stubFetch(
      projectFixture({
        iterations: [
          { id: 1, projectId: 7, seq: 1, imagePath: 'projects/7/iterations/1.png', accepted: true, role: 'front' },
          { id: 2, projectId: 7, seq: 2, imagePath: 'projects/7/iterations/2.png', accepted: false, role: null },
        ],
      }),
    );
    renderPage();

    await screen.findByText('Spring Open House Flyer');
    expect(screen.getByLabelText('Iteration 1 accepted')).toBeChecked();
    expect(screen.getByLabelText('Iteration 2 accepted')).not.toBeChecked();
    expect(screen.getByTestId('role-badge-1')).toHaveTextContent('front');
  });
});

/** A fake `response.body`: yields each string in `chunks` as one
 * `reader.read()` call, then signals `done` -- same fixture shape as
 * `ProjectDetailChatPanel.test.tsx`'s `fakeStreamBody`. */
function fakeStreamBody(chunks: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    getReader() {
      return {
        read: async () => {
          if (index >= chunks.length) return { done: true, value: undefined };
          const value = encoder.encode(chunks[index]);
          index += 1;
          return { done: false, value };
        },
      };
    },
  };
}

function sseFrames(events: unknown[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
}

describe('ProjectDetail -- SUC-015 wiring: chat SSE search_catalog opens the library drawer', () => {
  it('a scripted tool_call_finished(search_catalog) SSE event updates and opens the drawer, without a page reload', async () => {
    const searchMatches = [
      { ownerType: 'asset', ownerId: 100, matchedVia: ['vector'], score: 0.87, path: 'assets/logo-robot.png', label: 'robot logo' },
    ];
    const chatFrames = sseFrames([
      { type: 'tool_call_started', callId: '1', name: 'search_catalog', args: { query: 'robots' } },
      { type: 'tool_call_finished', callId: '1', name: 'search_catalog', args: { query: 'robots' }, result: searchMatches, isError: false },
      { type: 'message', content: 'Here are the assets with robots in them.' },
    ]);

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/projects/7' && (!init || !init.method)) {
        return Promise.resolve({ ok: true, json: async () => projectFixture() } as Response);
      }
      if (url === '/api/catalog/tree') {
        return Promise.resolve({ ok: true, json: async () => ({ directories: [] }) } as Response);
      }
      if (url === '/api/projects?view=all') {
        return Promise.resolve({ ok: true, json: async () => ({ projects: [] }) } as Response);
      }
      if (url === '/api/projects/7/chat' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, body: fakeStreamBody([chatFrames]) } as Response);
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    await screen.findByText('Spring Open House Flyer');

    // Drawer starts closed -- no result has arrived yet.
    expect(screen.getByTestId('library-overlay')).toHaveAttribute('data-open', 'false');

    fireEvent.change(screen.getByLabelText('Message Claude…'), {
      target: { value: 'show me the assets with robots in them' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByText('Here are the assets with robots in them.');

    // The SSE event -- not a page reload -- drove this: the drawer opened
    // and now shows exactly the matched item.
    await waitFor(() => expect(screen.getByTestId('library-overlay')).toHaveAttribute('data-open', 'true'));
    expect(screen.getByText('robot logo')).toBeInTheDocument();

    const getProjectCalls = fetchMock.mock.calls.filter(([url, init]) => url === '/api/projects/7' && !init?.method);
    expect(getProjectCalls).toHaveLength(1);
  });

  it('an empty search_catalog match set opens the drawer to a broaden-your-query state, not an error (UC-014 E1)', async () => {
    const chatFrames = sseFrames([
      { type: 'tool_call_finished', callId: '1', name: 'search_catalog', args: { query: 'unicorns' }, result: [], isError: false },
      { type: 'message', content: "I couldn't find anything matching that." },
    ]);

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/projects/7' && (!init || !init.method)) {
        return Promise.resolve({ ok: true, json: async () => projectFixture() } as Response);
      }
      if (url === '/api/catalog/tree') {
        return Promise.resolve({ ok: true, json: async () => ({ directories: [] }) } as Response);
      }
      if (url === '/api/projects?view=all') {
        return Promise.resolve({ ok: true, json: async () => ({ projects: [] }) } as Response);
      }
      if (url === '/api/projects/7/chat' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, body: fakeStreamBody([chatFrames]) } as Response);
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    await screen.findByText('Spring Open House Flyer');

    fireEvent.change(screen.getByLabelText('Message Claude…'), { target: { value: 'show me unicorns' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByText("I couldn't find anything matching that.");
    await waitFor(() => expect(screen.getByTestId('library-overlay')).toHaveAttribute('data-open', 'true'));
    expect(screen.getByTestId('library-empty')).toHaveTextContent(/broadening your query/i);
    expect(screen.queryByTestId('chat-error')).not.toBeInTheDocument();
  });
});
