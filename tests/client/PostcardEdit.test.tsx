import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import PostcardEdit from '../../client/src/pages/PostcardEdit';

/**
 * Coverage for `client/src/pages/PostcardEdit.tsx` (ticket 005-012,
 * SUC-009): the real postcard text-region editor promoted from
 * `MockupPostcardEdit.tsx`. Mirrors that mockup's own test suite's
 * structure/selectors where the interaction mechanics are unchanged (drag-
 * to-draw, move handles, click-to-edit, QR popup), and adds coverage for
 * the two real data seams this ticket wires up: `Iteration.role`-sourced
 * preview images and the PUT-then-POST persistence round trip.
 */

function projectFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    title: 'Spring Open House Flyer',
    status: 'active',
    iterations: [
      { id: 1, projectId: 7, seq: 1, imagePath: 'projects/7/iterations/1.png', accepted: true, role: 'front' },
      { id: 2, projectId: 7, seq: 2, imagePath: 'projects/7/iterations/2.png', accepted: true, role: 'back' },
    ],
    references: [],
    chatMessages: [],
    ...overrides,
  };
}

function stubFetch(
  project: unknown,
  extra?: (url: string, init: RequestInit | undefined) => Response | undefined,
) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const handled = extra?.(url, init);
    if (handled) return Promise.resolve(handled);
    if (url === '/api/projects/7' && (!init || !init.method)) {
      return Promise.resolve({ ok: true, json: async () => project } as Response);
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function renderPage(initialEntries = ['/projects/7/postcard']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/projects/:id/postcard" element={<PostcardEdit />} />
        <Route path="/projects/:id" element={<p>Iterations view</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** AC: "Asset browser (`LibraryDrawer`) never renders on this route --
 * verify by asserting its absence in every test for this page, not just by
 * omission." Called from every `it` below, after the page has settled. */
function assertNoLibraryDrawer() {
  expect(screen.queryByTestId('library-overlay')).not.toBeInTheDocument();
  expect(screen.queryByTestId('library-items')).not.toBeInTheDocument();
}

async function settle() {
  await screen.findByTestId('postcard-preview');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PostcardEdit -- front/back tab previews via GET /api/files/* (AC1)', () => {
  it('renders the front preview from the front-role Iteration.imagePath, not a hardcoded mockup path', async () => {
    stubFetch(projectFixture());
    renderPage();
    await settle();

    const img = screen.getByRole('img', { name: /front preview/i });
    expect(img).toHaveAttribute('src', '/api/files/projects/7/iterations/1.png');
    assertNoLibraryDrawer();
  });

  it('switching to the back tab renders the back-role Iteration.imagePath', async () => {
    const user = userEvent.setup();
    stubFetch(projectFixture());
    renderPage();
    await settle();

    await user.click(screen.getByRole('button', { name: /^back$/i }));
    const img = screen.getByRole('img', { name: /back preview/i });
    expect(img).toHaveAttribute('src', '/api/files/projects/7/iterations/2.png');
    assertNoLibraryDrawer();
  });

  it('shows a placeholder, not a broken image, when a side has no marked iteration', async () => {
    stubFetch(
      projectFixture({
        iterations: [{ id: 1, projectId: 7, seq: 1, imagePath: 'projects/7/iterations/1.png', accepted: true, role: 'front' }],
      }),
    );
    renderPage();
    await settle();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.queryByRole('img', { name: /back preview/i })).not.toBeInTheDocument();
    expect(screen.getByText(/no back image yet/i)).toBeInTheDocument();
    assertNoLibraryDrawer();
  });

  it('shows no instructional hint text overlaid on the image itself (OOP change: removed)', async () => {
    const user = userEvent.setup();
    stubFetch(projectFixture());
    renderPage();
    await settle();

    expect(screen.queryByText(/image only/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/drag to draw a text box/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.queryByText(/image only/i)).not.toBeInTheDocument();
    assertNoLibraryDrawer();
  });
});

describe('PostcardEdit -- no text-region list section (round 10)', () => {
  it('never renders a separate regions list section', async () => {
    stubFetch(projectFixture());
    renderPage();
    await settle();

    expect(screen.queryByText(/regions —/i)).not.toBeInTheDocument();
    assertNoLibraryDrawer();
  });
});

describe('PostcardEdit -- drag-to-draw a new box (AC3)', () => {
  it('rubber-bands from the anchor, names on release, creates a box at the exact drawn size, overflow clipped', async () => {
    const user = userEvent.setup();
    stubFetch(projectFixture());
    renderPage();
    await settle();

    const preview = screen.getByTestId('postcard-preview');
    fireEvent.mouseDown(preview, { clientX: 100, clientY: 50 });
    fireEvent.mouseMove(preview, { clientX: 240, clientY: 120 });
    expect(screen.getByTestId('draw-rubber-band')).toBeInTheDocument();
    fireEvent.mouseUp(preview);

    const dialog = screen.getByRole('dialog', { name: /name new text box/i });
    const nameInput = within(dialog).getByLabelText(/text box name/i);
    await user.type(nameInput, 'Headline{Enter}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const box = screen.getByTestId('postcard-region-box-front_headline');
    // jsdom fallback: 96px/in. (240-100)x(120-50) from (100,50).
    expect(box).toHaveStyle({ left: '1.04in', top: '0.52in', width: '1.46in', height: '0.73in' });
    // The drawn box carries an explicit height -- postcardRender.ts clips
    // overflow at that height rather than growing the box to fit text. The
    // clip lives on the inner text layer (so the label tag can straddle the
    // box's top border without being clipped).
    expect(screen.getByTestId('postcard-region-text-front_headline')).toHaveClass('overflow-hidden');
    assertNoLibraryDrawer();
  });
});

/** Draws a box named "Headline" on the front side and returns its testid
 * suffix (`front_headline`) -- shared setup for the click-edit/move/delete
 * tests below, which all need an existing box to interact with. */
async function drawFrontHeadlineBox(user: ReturnType<typeof userEvent.setup>) {
  const preview = screen.getByTestId('postcard-preview');
  fireEvent.mouseDown(preview, { clientX: 100, clientY: 50 });
  fireEvent.mouseMove(preview, { clientX: 240, clientY: 120 });
  fireEvent.mouseUp(preview);
  const dialog = screen.getByRole('dialog', { name: /name new text box/i });
  await user.type(within(dialog).getByLabelText(/text box name/i), 'Headline{Enter}');
}

describe('PostcardEdit -- click-to-edit popup (AC2)', () => {
  it('opens on click, sized to fit text, Return commits the edit', async () => {
    const user = userEvent.setup();
    stubFetch(projectFixture());
    renderPage();
    await settle();
    await drawFrontHeadlineBox(user);

    await user.click(screen.getByTestId('postcard-region-box-front_headline'));
    const dialog = screen.getByRole('dialog', { name: /edit headline/i });
    const popupInput = within(dialog).getByLabelText(/headline text/i);
    await user.type(popupInput, 'ROBOT RIOT{Enter}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('postcard-region-text-front_headline')).toHaveTextContent('ROBOT RIOT');
    assertNoLibraryDrawer();
  });

  it('Escape discards the draft', async () => {
    const user = userEvent.setup();
    stubFetch(projectFixture());
    renderPage();
    await settle();
    await drawFrontHeadlineBox(user);

    await user.click(screen.getByTestId('postcard-region-box-front_headline'));
    const dialog = screen.getByRole('dialog', { name: /edit headline/i });
    await user.type(within(dialog).getByLabelText(/headline text/i), 'DISCARD ME{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('postcard-region-text-front_headline')).toHaveTextContent('');
    assertNoLibraryDrawer();
  });

  it('the popup carries a Delete button that removes the box', async () => {
    const user = userEvent.setup();
    stubFetch(projectFixture());
    renderPage();
    await settle();
    await drawFrontHeadlineBox(user);

    await user.click(screen.getByTestId('postcard-region-box-front_headline'));
    const dialog = screen.getByRole('dialog', { name: /edit headline/i });
    await user.click(within(dialog).getByRole('button', { name: /delete/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('postcard-region-box-front_headline')).not.toBeInTheDocument();
    assertNoLibraryDrawer();
  });
});

describe('PostcardEdit -- move/resize handles (AC4)', () => {
  it('dragging the top-left handle repositions the box (size unchanged)', async () => {
    const user = userEvent.setup();
    stubFetch(projectFixture());
    renderPage();
    await settle();
    await drawFrontHeadlineBox(user);

    const preview = screen.getByTestId('postcard-preview');
    fireEvent.mouseDown(screen.getByTestId('move-handle-tl-front_headline'), { clientX: 100, clientY: 50 });
    fireEvent.mouseMove(preview, { clientX: 150, clientY: 80 });
    fireEvent.mouseUp(preview);

    // jsdom performs no layout, so `box.offsetLeft/offsetTop` (the drag's
    // start position) is always 0 -- the resulting position is just the
    // drag delta converted at the 96px/in jsdom fallback: (50, 30)px -> (0.52in, 0.31in).
    const box = screen.getByTestId('postcard-region-box-front_headline');
    expect(box).toHaveStyle({ left: '0.52in', top: '0.31in', width: '1.46in', height: '0.73in' });
    assertNoLibraryDrawer();
  });

  it('dragging the bottom-right handle resizes the box (top-left corner unchanged)', async () => {
    const user = userEvent.setup();
    stubFetch(projectFixture());
    renderPage();
    await settle();
    await drawFrontHeadlineBox(user);

    const preview = screen.getByTestId('postcard-preview');
    fireEvent.mouseDown(screen.getByTestId('move-handle-br-front_headline'), { clientX: 500, clientY: 200 });
    fireEvent.mouseMove(preview, { clientX: 550, clientY: 230 });
    fireEvent.mouseUp(preview);

    // jsdom reports 0 for offsetWidth/offsetHeight (the drag's starting
    // size), so the resulting size is just the drag delta converted at the
    // 96px/in jsdom fallback: (50, 30)px -> (0.52in, 0.31in). top/left stay
    // at the box's original drawn position.
    const box = screen.getByTestId('postcard-region-box-front_headline');
    expect(box).toHaveStyle({ left: '1.04in', top: '0.52in', width: '0.52in', height: '0.31in' });
    assertNoLibraryDrawer();
  });

  it('clamps the resize to a minimum size instead of collapsing to zero', async () => {
    const user = userEvent.setup();
    stubFetch(projectFixture());
    renderPage();
    await settle();
    await drawFrontHeadlineBox(user);

    const preview = screen.getByTestId('postcard-preview');
    // Drag far up-and-left of the handle's start point -- a shrink well
    // past zero, which must clamp rather than go negative.
    fireEvent.mouseDown(screen.getByTestId('move-handle-br-front_headline'), { clientX: 500, clientY: 200 });
    fireEvent.mouseMove(preview, { clientX: 0, clientY: 0 });
    fireEvent.mouseUp(preview);

    const box = screen.getByTestId('postcard-region-box-front_headline');
    expect(box).toHaveStyle({ width: '0.30in', height: '0.20in' });
    assertNoLibraryDrawer();
  });

  it('a resize persists position.width/height into the PUT content JSON', async () => {
    const user = userEvent.setup();
    const pdfBlob = new Blob(['%PDF-1.7 fake'], { type: 'application/pdf' });
    const fetchMock = stubFetch(projectFixture(), (url, init) => {
      if (url === '/api/postcards/7' && init?.method === 'PUT') return { ok: true, json: async () => ({}) } as Response;
      if (url === '/api/postcards/7/pdf' && init?.method === 'POST') return { ok: true, blob: async () => pdfBlob } as Response;
      return undefined;
    });
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn().mockReturnValue('blob:fake-pdf-url') });
    vi.stubGlobal('open', vi.fn());

    renderPage();
    await settle();
    await drawFrontHeadlineBox(user);

    const preview = screen.getByTestId('postcard-preview');
    fireEvent.mouseDown(screen.getByTestId('move-handle-br-front_headline'), { clientX: 500, clientY: 200 });
    fireEvent.mouseMove(preview, { clientX: 550, clientY: 230 });
    fireEvent.mouseUp(preview);

    await user.click(screen.getByRole('button', { name: /generate pdf/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/postcards/7', expect.objectContaining({ method: 'PUT' }));
    });
    const putCall = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/postcards/7' && (init as RequestInit | undefined)?.method === 'PUT',
    )!;
    const body = JSON.parse((putCall[1] as RequestInit).body as string);
    expect(body.front_regions[0].position).toEqual({
      top: '0.52in',
      left: '1.04in',
      width: '0.52in',
      height: '0.31in',
    });
    assertNoLibraryDrawer();
  });
});

describe('PostcardEdit -- QR overlay is optional, addable, deletable, and movable (OOP change)', () => {
  it('shows no QR by default on either face -- an imported/fresh design has no QR data', async () => {
    const user = userEvent.setup();
    stubFetch(projectFixture());
    renderPage();
    await settle();

    expect(screen.queryByTestId('postcard-qr-box')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.queryByTestId('postcard-qr-box')).not.toBeInTheDocument();
    assertNoLibraryDrawer();
  });

  it('the "Add QR code" toolbar button adds a QR overlay to the CURRENT face only, at a default position', async () => {
    const user = userEvent.setup();
    stubFetch(projectFixture());
    renderPage();
    await settle();

    await user.click(screen.getByRole('button', { name: /add qr code/i }));

    const box = screen.getByTestId('postcard-qr-box');
    expect(box).toBeInTheDocument();
    expect(box).toHaveStyle({ top: '1.15in', right: '0.5in', width: '1.5in', height: '1.5in' });

    // Adding is per-face -- the back face still has no QR.
    await user.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.queryByTestId('postcard-qr-box')).not.toBeInTheDocument();

    // Switching back to front, the added QR is still there, and the
    // add button is now disabled (a face carries at most one QR).
    await user.click(screen.getByRole('button', { name: /^front$/i }));
    expect(screen.getByTestId('postcard-qr-box')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add qr code/i })).toBeDisabled();
    assertNoLibraryDrawer();
  });

  it('clicking the QR box opens its popup; Return sets the URL for the current face', async () => {
    const user = userEvent.setup();
    stubFetch(projectFixture());
    renderPage();
    await settle();
    await user.click(screen.getByRole('button', { name: /add qr code/i }));

    await user.click(screen.getByTestId('postcard-qr-box'));
    const dialog = screen.getByRole('dialog', { name: /qr code/i });
    const urlInput = within(dialog).getByLabelText(/qr code url/i);
    await user.type(urlInput, 'https://example.org/signup{Enter}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('postcard-qr-url')).toHaveTextContent('https://example.org/signup');
    assertNoLibraryDrawer();
  });

  it('the popup carries a Delete button that removes the QR from the current face', async () => {
    const user = userEvent.setup();
    stubFetch(projectFixture());
    renderPage();
    await settle();
    await user.click(screen.getByRole('button', { name: /add qr code/i }));
    await user.click(screen.getByTestId('postcard-qr-box'));

    const dialog = screen.getByRole('dialog', { name: /qr code/i });
    await user.click(within(dialog).getByRole('button', { name: /delete/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('postcard-qr-box')).not.toBeInTheDocument();
    // The add button is available again, now that the face has no QR.
    expect(screen.getByRole('button', { name: /add qr code/i })).not.toBeDisabled();
    assertNoLibraryDrawer();
  });

  it('long-click-drag on the top-left handle moves the QR, using the same mechanism as text-region move handles', async () => {
    const user = userEvent.setup();
    stubFetch(projectFixture());
    renderPage();
    await settle();
    await user.click(screen.getByRole('button', { name: /add qr code/i }));

    const preview = screen.getByTestId('postcard-preview');
    fireEvent.mouseDown(screen.getByTestId('move-handle-tl-qr'), { clientX: 100, clientY: 50 });
    fireEvent.mouseMove(preview, { clientX: 150, clientY: 80 });
    fireEvent.mouseUp(preview);

    // Same jsdom fallback as the text-region move-handle test: offsetLeft/
    // offsetTop start at 0, so the resulting position is just the drag
    // delta at 96px/in -- (50, 30)px -> (0.52in, 0.31in), and the QR's
    // `right` offset is cleared in favor of an explicit `left`. Size is
    // unchanged by a move.
    const box = screen.getByTestId('postcard-qr-box');
    expect(box).toHaveStyle({ left: '0.52in', top: '0.31in', width: '1.5in', height: '1.5in' });

    // A click right after the drag is swallowed (not treated as opening
    // the popup), matching the text-region move-handle behavior.
    await user.click(box);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    assertNoLibraryDrawer();
  });

  it('dragging the bottom-right handle resizes the QR box (top-left corner unchanged)', async () => {
    const user = userEvent.setup();
    stubFetch(projectFixture());
    renderPage();
    await settle();
    await user.click(screen.getByRole('button', { name: /add qr code/i }));

    const preview = screen.getByTestId('postcard-preview');
    fireEvent.mouseDown(screen.getByTestId('move-handle-br-qr'), { clientX: 500, clientY: 200 });
    fireEvent.mouseMove(preview, { clientX: 550, clientY: 230 });
    fireEvent.mouseUp(preview);

    // jsdom fallback: offsetWidth/offsetHeight (drag's starting size) are 0,
    // so the resulting size is just the drag delta at 96px/in -- (50, 30)px
    // -> (0.52in, 0.31in). top/left stay at the QR's default position.
    const box = screen.getByTestId('postcard-qr-box');
    expect(box).toHaveStyle({ top: '1.15in', right: '0.5in', width: '0.52in', height: '0.31in' });
    assertNoLibraryDrawer();
  });

  it('clamps the QR resize to a minimum size instead of collapsing to zero', async () => {
    const user = userEvent.setup();
    stubFetch(projectFixture());
    renderPage();
    await settle();
    await user.click(screen.getByRole('button', { name: /add qr code/i }));

    const preview = screen.getByTestId('postcard-preview');
    fireEvent.mouseDown(screen.getByTestId('move-handle-br-qr'), { clientX: 500, clientY: 200 });
    fireEvent.mouseMove(preview, { clientX: 0, clientY: 0 });
    fireEvent.mouseUp(preview);

    const box = screen.getByTestId('postcard-qr-box');
    expect(box).toHaveStyle({ width: '0.30in', height: '0.20in' });
    assertNoLibraryDrawer();
  });

  it('the moved QR position persists into the PUT content JSON as a structured front_qr/back_qr field', async () => {
    const user = userEvent.setup();
    const pdfBlob = new Blob(['%PDF-1.7 fake'], { type: 'application/pdf' });
    const fetchMock = stubFetch(projectFixture(), (url, init) => {
      if (url === '/api/postcards/7' && init?.method === 'PUT') return { ok: true, json: async () => ({}) } as Response;
      if (url === '/api/postcards/7/pdf' && init?.method === 'POST') return { ok: true, blob: async () => pdfBlob } as Response;
      return undefined;
    });
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn().mockReturnValue('blob:fake-pdf-url') });
    vi.stubGlobal('open', vi.fn());

    renderPage();
    await settle();
    await user.click(screen.getByRole('button', { name: /add qr code/i }));
    await user.click(screen.getByTestId('postcard-qr-box'));
    await user.type(
      within(screen.getByRole('dialog')).getByLabelText(/qr code url/i),
      'https://example.org/rsvp{Enter}',
    );

    const preview = screen.getByTestId('postcard-preview');
    fireEvent.mouseDown(screen.getByTestId('move-handle-tl-qr'), { clientX: 100, clientY: 50 });
    fireEvent.mouseMove(preview, { clientX: 150, clientY: 80 });
    fireEvent.mouseUp(preview);

    await user.click(screen.getByRole('button', { name: /generate pdf/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/postcards/7', expect.objectContaining({ method: 'PUT' }));
    });
    const putCall = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/postcards/7' && (init as RequestInit | undefined)?.method === 'PUT',
    )!;
    const body = JSON.parse((putCall[1] as RequestInit).body as string);
    expect(body.front_qr).toEqual({
      url: 'https://example.org/rsvp',
      position: { top: '0.31in', left: '0.52in', width: '1.5in', height: '1.5in' },
    });
    expect(body).not.toHaveProperty('back_qr');
    assertNoLibraryDrawer();
  });

  it('a QR resize persists position.width/height into the PUT content JSON', async () => {
    const user = userEvent.setup();
    const pdfBlob = new Blob(['%PDF-1.7 fake'], { type: 'application/pdf' });
    const fetchMock = stubFetch(projectFixture(), (url, init) => {
      if (url === '/api/postcards/7' && init?.method === 'PUT') return { ok: true, json: async () => ({}) } as Response;
      if (url === '/api/postcards/7/pdf' && init?.method === 'POST') return { ok: true, blob: async () => pdfBlob } as Response;
      return undefined;
    });
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn().mockReturnValue('blob:fake-pdf-url') });
    vi.stubGlobal('open', vi.fn());

    renderPage();
    await settle();
    await user.click(screen.getByRole('button', { name: /add qr code/i }));
    await user.click(screen.getByTestId('postcard-qr-box'));
    await user.type(
      within(screen.getByRole('dialog')).getByLabelText(/qr code url/i),
      'https://example.org/rsvp{Enter}',
    );

    const preview = screen.getByTestId('postcard-preview');
    fireEvent.mouseDown(screen.getByTestId('move-handle-br-qr'), { clientX: 500, clientY: 200 });
    fireEvent.mouseMove(preview, { clientX: 550, clientY: 230 });
    fireEvent.mouseUp(preview);

    await user.click(screen.getByRole('button', { name: /generate pdf/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/postcards/7', expect.objectContaining({ method: 'PUT' }));
    });
    const putCall = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/postcards/7' && (init as RequestInit | undefined)?.method === 'PUT',
    )!;
    const body = JSON.parse((putCall[1] as RequestInit).body as string);
    expect(body.front_qr).toEqual({
      url: 'https://example.org/rsvp',
      position: { top: '1.15in', right: '0.5in', width: '0.52in', height: '0.31in' },
    });
    assertNoLibraryDrawer();
  });
});

describe('PostcardEdit -- chat box (AC6)', () => {
  it('renders the real chat panel, wired to the SSE mechanism (no separate stream logic)', async () => {
    stubFetch(projectFixture({ chatMessages: [{ id: 1, projectId: 7, role: 'assistant', content: 'Hi there', createdAt: '2026-07-14T00:00:00Z' }] }));
    renderPage();
    await settle();

    expect(screen.getByPlaceholderText(/message claude/i)).toBeInTheDocument();
    expect(screen.getByText('Hi there')).toBeInTheDocument();
    assertNoLibraryDrawer();
  });
});

describe('PostcardEdit -- asset browser never renders (AC7)', () => {
  it('renders no LibraryDrawer even after interacting with the page', async () => {
    const user = userEvent.setup();
    stubFetch(projectFixture());
    renderPage();
    await settle();
    assertNoLibraryDrawer();

    await user.click(screen.getByRole('button', { name: /^back$/i }));
    assertNoLibraryDrawer();
  });
});

describe('PostcardEdit -- Save + Generate PDF (AC9/AC10)', () => {
  it('is disabled until an iteration is marked front', async () => {
    stubFetch(
      projectFixture({
        iterations: [{ id: 2, projectId: 7, seq: 2, imagePath: 'projects/7/iterations/2.png', accepted: true, role: 'back' }],
      }),
    );
    renderPage();
    await settle();

    expect(screen.getByRole('button', { name: /generate pdf/i })).toBeDisabled();
    assertNoLibraryDrawer();
  });

  it('PUTs the content JSON (front/back images resolved from Iteration.role, plus regions) then POSTs .../pdf, then opens the result', async () => {
    const user = userEvent.setup();
    const pdfBlob = new Blob(['%PDF-1.7 fake'], { type: 'application/pdf' });
    const fetchMock = stubFetch(projectFixture(), (url, init) => {
      if (url === '/api/postcards/7' && init?.method === 'PUT') {
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (url === '/api/postcards/7/pdf' && init?.method === 'POST') {
        return { ok: true, blob: async () => pdfBlob } as Response;
      }
      return undefined;
    });
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn().mockReturnValue('blob:fake-pdf-url') });
    const openMock = vi.fn();
    vi.stubGlobal('open', openMock);

    renderPage();
    await settle();
    await drawFrontHeadlineBox(user);
    await user.click(screen.getByTestId('postcard-region-box-front_headline'));
    await user.type(within(screen.getByRole('dialog')).getByLabelText(/headline text/i), 'PDF HEADLINE{Enter}');

    await user.click(screen.getByRole('button', { name: /generate pdf/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/postcards/7', expect.objectContaining({ method: 'PUT' }));
    });
    const putCall = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/postcards/7' && (init as RequestInit | undefined)?.method === 'PUT',
    )!;
    const body = JSON.parse((putCall[1] as RequestInit).body as string);
    expect(body.front_image).toBe('projects/7/iterations/1.png');
    expect(body.back_image).toBe('projects/7/iterations/2.png');
    expect(body.front_regions).toEqual([
      {
        name: 'front_headline',
        label: 'Headline',
        style: '',
        text: 'PDF HEADLINE',
        position: { top: '0.52in', left: '1.04in', width: '1.46in', height: '0.73in' },
        font: { family: 'Arial, sans-serif', size: '14px' },
      },
    ]);
    expect(body.back_regions).toEqual([]);
    // No QR was added in this session -- the structured QR fields are
    // omitted entirely (AC1: no QR by default), not sent as empty
    // placeholders (the old `*_extra_html` behavior).
    expect(body).not.toHaveProperty('front_qr');
    expect(body).not.toHaveProperty('back_qr');

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/postcards/7/pdf', expect.objectContaining({ method: 'POST' }));
      expect(openMock).toHaveBeenCalledWith('blob:fake-pdf-url', '_blank');
    });
    assertNoLibraryDrawer();
  });

  it('omits back_image when no iteration currently holds role "back"', async () => {
    const user = userEvent.setup();
    const pdfBlob = new Blob(['%PDF-1.7 fake'], { type: 'application/pdf' });
    const fetchMock = stubFetch(
      projectFixture({
        iterations: [{ id: 1, projectId: 7, seq: 1, imagePath: 'projects/7/iterations/1.png', accepted: true, role: 'front' }],
      }),
      (url, init) => {
        if (url === '/api/postcards/7' && init?.method === 'PUT') return { ok: true, json: async () => ({}) } as Response;
        if (url === '/api/postcards/7/pdf' && init?.method === 'POST') return { ok: true, blob: async () => pdfBlob } as Response;
        return undefined;
      },
    );
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn().mockReturnValue('blob:fake-pdf-url') });
    vi.stubGlobal('open', vi.fn());

    renderPage();
    await settle();
    await user.click(screen.getByRole('button', { name: /generate pdf/i }));

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/postcards/7' && (init as RequestInit | undefined)?.method === 'PUT',
      );
      expect(putCall).toBeTruthy();
      const body = JSON.parse((putCall![1] as RequestInit).body as string);
      expect(body.front_image).toBe('projects/7/iterations/1.png');
      expect(body).not.toHaveProperty('back_image');
    });
    assertNoLibraryDrawer();
  });

  it('surfaces an error rather than silently failing when the PDF request fails', async () => {
    const user = userEvent.setup();
    stubFetch(projectFixture(), (url, init) => {
      if (url === '/api/postcards/7' && init?.method === 'PUT') return { ok: false, status: 500 } as Response;
      return undefined;
    });

    renderPage();
    await settle();
    await user.click(screen.getByRole('button', { name: /generate pdf/i }));

    await screen.findByText(/failed to generate the pdf/i);
    assertNoLibraryDrawer();
  });
});

describe('PostcardEdit -- back navigation (AC11)', () => {
  it('navigates to /projects/:id', async () => {
    const user = userEvent.setup();
    stubFetch(projectFixture());
    renderPage();
    await settle();

    await user.click(screen.getByRole('link', { name: /back to iterations/i }));
    expect(screen.getByText('Iterations view')).toBeInTheDocument();
  });
});
