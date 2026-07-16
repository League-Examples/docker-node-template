import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import App from '../../client/src/App';

/**
 * Sprint 005's capstone integration test (ticket 013, sprint.md Test
 * Strategy: "at least one integration-level test per major flow... using
 * mocked network/SSE responses"). Drives the full stakeholder-promised
 * walkthrough (sprint.md Goals: "log in, browse the library, start a
 * project by talking to Claude, drag in references, generate and iterate
 * images, edit postcard text, and see the result") through the live
 * `<App />` tree end to end, with every network and SSE response mocked --
 * no live OpenAI/OpenRouter/Anthropic calls, per sprint.md's "No live
 * OpenAI/OpenRouter calls in CI".
 *
 * **"Log in"** is represented the same way `App.test.tsx`'s routing-smoke
 * test already does: `AuthContext` mocked to an already-authenticated user.
 * The real Google OAuth handshake is a server-side redirect entirely
 * outside the SPA (`Login.tsx` only links to `/api/auth/google`) and can't
 * be meaningfully driven through mocked `fetch`/SSE -- this test instead
 * confirms the *consequence* of being logged in (`AppLayout`'s
 * authenticated shell renders, no redirect to `/login`), which is what
 * sprint.md's "no regression in Sprint 001's auth flow" success criterion
 * actually cares about.
 *
 * **"Drag a reference into a new project"** (sprint.md Goals' own wording)
 * is exercised as a double-click add -- this app's real, documented
 * interaction mechanism (`LibraryDrawer.tsx`'s own header comment,
 * stakeholder round 5); there is no native HTML5 drag-and-drop wired up
 * anywhere in `client/src` (confirmed by ticket 013's own grep audit), so
 * "drag" in the sprint's prose and "double-click" in the shipped UI refer
 * to the same user action.
 *
 * **A reload step is threaded in deliberately.** `OutputPane.tsx`'s and
 * `ProjectDetailsHeader.tsx`'s own header comments document this app's
 * design: a completed chat turn's side effects (a new `Iteration` row) are
 * not pushed back into `ProjectDetail`'s already-rendered state -- they
 * surface on the next `GET /api/projects/:id`, i.e. a reload. This test
 * performs that reload the way a real user would (navigating back to the
 * project list and back into the project), not by reaching into React
 * internals to fake a live push update.
 */

function sseFrames(events: unknown[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
}

/** Same fixture shape as `ProjectDetailChatPanel.test.tsx`'s `fakeStreamBody`. */
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

// ---- Mock AuthContext: bypass the real fetch-based provider and force an
// authenticated, non-admin user -- see module header re: "log in". ----

vi.mock('../../client/src/context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: {
      id: 1,
      email: 'user@example.com',
      displayName: 'Test User',
      role: 'USER',
      avatarUrl: null,
      provider: null,
      providerId: null,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  }),
}));

function navigateTo(path: string) {
  window.history.pushState({}, '', path);
}

/** A single in-memory "server" backing every mocked `fetch` call for the
 * walkthrough: one real project row that `POST`/`PATCH` calls mutate and
 * subsequent `GET`s reflect -- the same round-trip contract the real
 * Express routes this mirrors (`projects.ts`/`catalog.ts`/`postcards.ts`)
 * make, so the test never has to hand-wave "and now the state is X". */
function buildFetchMock() {
  const ASSET_ID = 100;
  const ASSET_PATH = 'assets/logo-robot.png';

  const catalogTree = {
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
            assets: [{ id: ASSET_ID, path: ASSET_PATH, description: 'League robot logo' }],
          },
        ],
        knowledgeEntries: [],
      },
    ],
  };

  let projectCreated = false;
  let postcardContent: Record<string, unknown> | null = null;
  const project = {
    id: 42,
    title: 'Untitled project',
    status: 'active',
    detailsHeader: null as Record<string, unknown> | null,
    iterations: [] as Array<{
      id: number;
      projectId: number;
      seq: number;
      imagePath: string;
      accepted: boolean;
      role: 'front' | 'back' | null;
    }>,
    references: [] as Array<{ id: number; projectId: number; assetId: number; role: string }>,
    chatMessages: [] as Array<{ id: number; projectId: number; role: string; content: string; createdAt: string }>,
  };
  let nextMessageId = 1;
  let chatTurn = 0;

  function projectDetailPayload() {
    return {
      id: project.id,
      title: project.title,
      status: project.status,
      detailsHeader: project.detailsHeader,
      iterations: project.iterations,
      references: project.references.map((r) => ({ ...r, asset: { id: r.assetId, path: ASSET_PATH } })),
      chatMessages: project.chatMessages,
    };
  }

  function projectSummary() {
    return {
      id: project.id,
      title: project.title,
      status: project.status,
      detailsHeader: project.detailsHeader,
      owner: { id: 1, email: 'user@example.com', displayName: 'Test User' },
      iterations: project.iterations,
    };
  }

  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url === '/api/health') {
      return Promise.resolve({ ok: true, json: async () => ({ appName: 'Flyerbot' }) } as Response);
    }

    if (url === '/api/catalog/tree') {
      return Promise.resolve({ ok: true, json: async () => catalogTree } as Response);
    }

    if (url.startsWith('/api/projects?view=')) {
      const view = url.split('view=')[1];
      const list = view === 'mine' && projectCreated ? [projectSummary()] : [];
      return Promise.resolve({ ok: true, json: async () => ({ projects: list }) } as Response);
    }

    if (url === '/api/projects' && method === 'POST') {
      projectCreated = true;
      return Promise.resolve({ ok: true, json: async () => ({ id: project.id, title: project.title }) } as Response);
    }

    if (url === `/api/projects/${project.id}` && method === 'GET') {
      return Promise.resolve({ ok: true, json: async () => projectDetailPayload() } as Response);
    }

    if (url === `/api/projects/${project.id}/references` && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const reference = { id: 500, projectId: project.id, assetId: body.assetId, role: body.role ?? 'style' };
      project.references.push(reference);
      return Promise.resolve({
        ok: true,
        json: async () => ({ ...reference, asset: { id: reference.assetId, path: ASSET_PATH } }),
      } as Response);
    }

    if (url === `/api/projects/${project.id}/chat` && method === 'POST') {
      chatTurn += 1;
      const body = JSON.parse(String(init?.body ?? '{}'));
      project.chatMessages.push({
        id: nextMessageId++,
        projectId: project.id,
        role: 'user',
        content: body.message,
        createdAt: new Date().toISOString(),
      });

      // Simulates the server-side effect of a `generate_image` tool call:
      // a new `Iteration` row is persisted (available on the next reload --
      // see module header), even though this SSE stream itself only tells
      // the chat panel *that* generation happened, not the new gallery
      // state (`ChatPanel.tsx`/`ProjectDetail/index.tsx`'s own contract).
      // Sprint 005 OOP change, 2026-07-15: the new row is tagged into
      // whichever stream tab was active when the message was sent
      // (`body.activeFace`, defaulting to `'front'`), mirroring
      // `realImageVisionClient.ts`'s own `role: input.activeFace ?? 'front'`.
      const seq = project.iterations.length + 1;
      const imagePath = `projects/${project.id}/iterations/${seq}.png`;
      const role: 'front' | 'back' = body.activeFace === 'back' ? 'back' : 'front';
      project.iterations.push({ id: seq, projectId: project.id, seq, imagePath, accepted: false, role });

      const replyText =
        chatTurn === 1
          ? "Here's iteration 1 -- a warm postcard design featuring the robot logo."
          : "Here's iteration 2 -- brighter colors, same layout.";
      project.chatMessages.push({
        id: nextMessageId++,
        projectId: project.id,
        role: 'assistant',
        content: replyText,
        createdAt: new Date().toISOString(),
      });

      const frames = sseFrames([
        { type: 'status', status: 'started' },
        { type: 'tool_call_started', callId: String(chatTurn), name: 'generate_image', args: { prompt: body.message } },
        {
          type: 'tool_call_finished',
          callId: String(chatTurn),
          name: 'generate_image',
          args: {},
          result: { iterationId: seq, imagePath },
          isError: false,
        },
        { type: 'message', content: replyText },
        { type: 'status', status: 'completed' },
      ]);
      return Promise.resolve({ ok: true, body: fakeStreamBody([frames]) } as Response);
    }

    const patchMatch = url.match(new RegExp(`^/api/projects/${project.id}/iterations/(\\d+)$`));
    if (patchMatch && method === 'PATCH') {
      const iterId = Number(patchMatch[1]);
      const body = JSON.parse(String(init?.body ?? '{}'));
      const target = project.iterations.find((it) => it.id === iterId);
      if (!target) return Promise.resolve({ ok: false, status: 404 } as Response);
      if (Object.prototype.hasOwnProperty.call(body, 'accepted')) {
        target.accepted = body.accepted;
        if (body.accepted) {
          project.iterations.forEach((it) => {
            if (it.id !== iterId) it.accepted = false;
          });
        }
      }
      if (Object.prototype.hasOwnProperty.call(body, 'role')) {
        if (body.role !== null) {
          project.iterations.forEach((it) => {
            if (it.id !== iterId && it.role === body.role) it.role = null;
          });
        }
        target.role = body.role;
      }
      return Promise.resolve({ ok: true, json: async () => ({ ...target }) } as Response);
    }

    // `usePostcardEditorState`'s load-on-mount GET (Sprint 005 OOP change,
    // 2026-07-15) + the debounced-autosave/PDF-button PUT it also fires --
    // tracked in-memory the same way every other mutation in this mock is,
    // so a GET after a PUT reflects what was actually saved.
    if (url === `/api/postcards/${project.id}` && method === 'GET') {
      return Promise.resolve({ ok: true, json: async () => ({ content: postcardContent }) } as Response);
    }
    if (url === `/api/postcards/${project.id}` && method === 'PUT') {
      postcardContent = JSON.parse(String(init?.body ?? '{}'));
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    }

    if (url === `/api/postcards/${project.id}/pdf` && method === 'POST') {
      const blob = new Blob(['%PDF-1.7 fake'], { type: 'application/pdf' });
      return Promise.resolve({ ok: true, blob: async () => blob } as Response);
    }

    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
  });
}

const originalCreateObjectURL = URL.createObjectURL;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  URL.createObjectURL = originalCreateObjectURL;
});

describe('Full walkthrough (sprint 005 capstone, sprint.md Success Criteria)', () => {
  it(
    'log in -> browse library -> new project -> add a reference -> generate + iterate an image over ' +
      'chat -> mark it accepted -> edit postcard text -> generate a PDF, with no console error and no ' +
      'silently-swallowed agent-runtime failure',
    async () => {
      const user = userEvent.setup();
      const fetchMock = buildFetchMock();
      vi.stubGlobal('fetch', fetchMock);
      // Stub `URL.createObjectURL` in place rather than replacing the
      // `URL` global wholesale (`vi.stubGlobal('URL', ...)`, the pattern
      // `ProjectDetailOutputPane.test.tsx`/`PostcardEdit.test.tsx` use) --
      // this test renders the real `<App />` tree, which uses
      // `BrowserRouter`, and react-router's `BrowserRouter` constructs real
      // `new URL(...)` instances internally. Those other tests get away
      // with the wholesale replacement only because they render bare
      // components under `MemoryRouter`, which never calls `URL` itself.
      const createObjectURLMock = vi.fn().mockReturnValue('blob:fake-pdf-url');
      URL.createObjectURL = createObjectURLMock as unknown as typeof URL.createObjectURL;
      const openMock = vi.fn();
      vi.stubGlobal('open', openMock);
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      // ---- Log in (AuthContext mocked authenticated; see module header) +
      // land on the project list. ----
      navigateTo('/');
      render(<App />);
      expect(await screen.findByTestId('user-menu-trigger')).toBeInTheDocument();
      expect(within(screen.getByRole('navigation', { name: 'Primary' })).getByText('Projects')).toBeInTheDocument();

      // ---- Browse the library. ----
      fireEvent.click(screen.getByRole('button', { name: 'Library' }));
      expect(await screen.findByText('logo robot')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'My projects' }));

      // ---- New project (OOP follow-up, 2026-07-16: name + description
      // modal, rather than an immediate create). ----
      fireEvent.click(screen.getByRole('button', { name: 'New project' }));
      expect(screen.getByRole('dialog', { name: 'New project' })).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Untitled project' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create' }));
      await screen.findByTestId('chat-empty-state');
      expect(screen.getByTestId('project-details-header')).toHaveTextContent(/no project details yet/i);

      // ---- Drag/double-click a reference into the project (see module
      // header re: "drag" vs. this app's real double-click mechanism). ----
      fireEvent.click(screen.getByRole('button', { name: 'Open library' }));
      const addButton = await screen.findByRole('button', { name: 'Add logo robot' });
      fireEvent.doubleClick(addButton);
      await waitFor(() => expect(screen.getByTestId('library-overlay')).toHaveAttribute('data-open', 'false'));
      expect(await screen.findByTestId('project-references')).toBeInTheDocument();

      // ---- Chat turn 1: generate an image. ----
      fireEvent.change(screen.getByLabelText('Message Claude…'), {
        target: { value: 'Make a postcard with the robot logo, warm colors' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      expect(await screen.findByText(/iteration 1/i)).toBeInTheDocument();
      expect(screen.queryByTestId('chat-error')).not.toBeInTheDocument();

      // ---- Chat turn 2: iterate. ----
      fireEvent.change(screen.getByLabelText('Message Claude…'), {
        target: { value: 'Make it brighter' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      expect(await screen.findByText(/iteration 2/i)).toBeInTheDocument();
      expect(screen.queryByTestId('chat-error')).not.toBeInTheDocument();

      // The output pane doesn't show either generated iteration yet --
      // this app's documented "surfaces on the next reload" design (see
      // module header). Confirm that's still true before reloading.
      expect(screen.getByText('No front iterations yet.')).toBeInTheDocument();

      // ---- Reload (navigate out and back in) to pick up the generated
      // iterations, then mark the first one accepted. Both generated
      // iterations already landed in the Front stream (Sprint 005 OOP
      // change, 2026-07-15: `generate_image` tags new iterations into
      // whichever tab is active, and this walkthrough never switches off
      // the default Front tab) -- no separate "mark as front" step is
      // needed anymore; accepting is the only remaining action. ----
      fireEvent.click(screen.getByRole('link', { name: 'Back to projects' }));
      const projectCard = (await screen.findByText('Untitled project')).closest('a')!;
      fireEvent.click(projectCard);

      await screen.findByTestId('iteration-row-1');
      expect(screen.getByTestId('iteration-row-2')).toBeInTheDocument();

      fireEvent.click(screen.getByLabelText('Iteration 1 accepted'));
      await waitFor(() => expect(screen.getByLabelText('Iteration 1 accepted')).toBeChecked());

      // ---- Edit postcard text INLINE -- accepting iteration 1 (above)
      // immediately reveals its `PostcardFaceEditor` right in the stream;
      // there is no separate "Text Entry" page/navigation anymore
      // (Sprint 005 OOP change, 2026-07-15: `pages/PostcardEdit.tsx`
      // deleted). ----
      await screen.findByTestId('postcard-preview');
      expect(screen.getByRole('img', { name: /front preview/i })).toHaveAttribute(
        'src',
        '/api/files/projects/42/iterations/1.png',
      );

      await user.click(screen.getByRole('button', { name: 'Add text box' }));

      await user.click(screen.getByTestId('postcard-region-box-front_text_1'));
      const editDialog = screen.getByRole('dialog', { name: /edit text 1/i });
      await user.type(within(editDialog).getByLabelText(/text 1 text/i), 'ROBOTS WELCOME{Enter}');
      expect(screen.getByTestId('postcard-region-text-front_text_1')).toHaveTextContent('ROBOTS WELCOME');

      // ---- Generate a PDF (the fixed-header PDF button, moved from the
      // deleted `PostcardEdit.tsx` page to `ProjectDetail/index.tsx`). ----
      await waitFor(() => expect(screen.getByRole('button', { name: 'PDF' })).toBeEnabled());
      await user.click(screen.getByRole('button', { name: 'PDF' }));
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith('/api/postcards/42', expect.objectContaining({ method: 'PUT' }));
        expect(fetchMock).toHaveBeenCalledWith('/api/postcards/42/pdf', expect.objectContaining({ method: 'POST' }));
        expect(openMock).toHaveBeenCalledWith('blob:fake-pdf-url', '_blank');
      });

      // ---- Sprint success criterion: "completes without a console error
      // or an unhandled agent-runtime failure surfaced silently." ----
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(consoleError).not.toHaveBeenCalled();
    },
  );
});
