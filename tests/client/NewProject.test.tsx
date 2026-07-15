import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProjectList from '../../client/src/pages/ProjectList';
import ProjectDetail from '../../client/src/pages/ProjectDetail';

/**
 * Coverage for the "New project" flow (ticket 005-011, SUC-004): promoting
 * `MockupNewProject.tsx` to the real thing. There is no separate
 * `NewProject.tsx` page/route -- both the `ProjectList` "New project"
 * button (ticket 008) and Claude's own `create_project` chat path converge
 * on the real `ProjectDetail` (ticket 009) once the `Project` row exists,
 * per this ticket's Description. So this file covers exactly what's
 * net-new here: `ProjectDetailsHeader`'s blank/filled rendering and the
 * chat panel's opening guideline-questions empty state, plus the
 * button-click -> POST -> navigate -> empty-`ProjectDetail`-renders
 * integration sequence.
 */

function freshProjectFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    title: 'Untitled project',
    status: 'active',
    detailsHeader: null,
    iterations: [],
    references: [],
    chatMessages: [],
    ...overrides,
  };
}

function stubProjectDetailFetch(project: unknown, projectId: number) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === `/api/projects/${projectId}` && (!init || !init.method)) {
      return Promise.resolve({ ok: true, json: async () => project } as Response);
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

function renderProjectDetail(projectId: number) {
  return render(
    <MemoryRouter initialEntries={[`/projects/${projectId}`]}>
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

describe('New project -- empty-project render (SUC-004)', () => {
  it('renders a blank project-details header, an empty output area, and no chat history', async () => {
    stubProjectDetailFetch(freshProjectFixture(), 42);
    renderProjectDetail(42);

    await screen.findByText('Untitled project');

    expect(screen.getByTestId('project-details-header')).toHaveTextContent(/no project details yet/i);
    expect(screen.getByText('No iterations yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('project-references')).not.toBeInTheDocument();
  });

  it("the chat panel's opening state matches the guideline-questions framing (style / output type / goal)", async () => {
    stubProjectDetailFetch(freshProjectFixture(), 42);
    renderProjectDetail(42);

    await screen.findByText('Untitled project');

    const emptyState = screen.getByTestId('chat-empty-state');
    expect(emptyState).toHaveTextContent(/style/i);
    expect(emptyState).toHaveTextContent(/output/i);
    expect(emptyState).toHaveTextContent(/achieve/i);
  });

  it('a project-details header with partial values renders each filled field and a placeholder for the rest', async () => {
    stubProjectDetailFetch(
      freshProjectFixture({ title: 'Spring Postcard', detailsHeader: { style: 'Pop Art' } }),
      42,
    );
    renderProjectDetail(42);

    await screen.findByText('Spring Postcard');

    const header = screen.getByTestId('project-details-header');
    expect(header).toHaveTextContent('Pop Art');
    expect(header).toHaveTextContent('Not set yet');
  });

  it('as create_project fills detailsHeader, the header renders the updated values on the next GET refresh', async () => {
    stubProjectDetailFetch(
      freshProjectFixture({
        title: 'Spring Postcard',
        detailsHeader: { style: 'Pop Art', outputType: 'Postcard', goal: 'Announce the open house' },
      }),
      42,
    );
    renderProjectDetail(42);

    await screen.findByText('Spring Postcard');

    const header = screen.getByTestId('project-details-header');
    expect(header).toHaveTextContent('Pop Art');
    expect(header).toHaveTextContent('Postcard');
    expect(header).toHaveTextContent('Announce the open house');
    expect(header).not.toHaveTextContent(/no project details yet/i);
  });
});

describe('New project -- button-click -> POST -> navigate -> empty ProjectDetail (SUC-004 integration)', () => {
  it('clicking "New project" creates a real Project row and lands on its (empty) ProjectDetail', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/projects?view=')) {
        return Promise.resolve({ ok: true, json: async () => ({ projects: [] }) } as Response);
      }
      if (url === '/api/projects' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ id: 42, title: 'Untitled project' }) } as Response);
      }
      if (url === '/api/projects/42' && (!init || !init.method)) {
        return Promise.resolve({ ok: true, json: async () => freshProjectFixture() } as Response);
      }
      if (url === '/api/catalog/tree') {
        return Promise.resolve({ ok: true, json: async () => ({ directories: [] }) } as Response);
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<ProjectList />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'New project' }));

    await screen.findByText('Untitled project');
    expect(fetchMock).toHaveBeenCalledWith('/api/projects', expect.objectContaining({ method: 'POST' }));

    // Lands on the blank/empty-project experience -- no separate NewProject
    // route or component, per this ticket's Description.
    expect(screen.getByTestId('project-details-header')).toHaveTextContent(/no project details yet/i);
    expect(screen.getByText('No iterations yet.')).toBeInTheDocument();
    expect(screen.getByTestId('chat-empty-state')).toBeInTheDocument();
  });
});
