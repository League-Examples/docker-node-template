import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import OutputPane, { applyIterationPatch } from '../../client/src/pages/ProjectDetail/OutputPane';
import type { IterationDTO } from '../../client/src/pages/ProjectDetail/types';

/**
 * Coverage for `client/src/pages/ProjectDetail/OutputPane.tsx` (ticket
 * 005-009): the real iteration gallery promoted from
 * `MockupOutputPane.tsx` -- vertical/one-per-row layout, the 800x800
 * media cap, the accepted-checkbox and front/back-pulldown exclusivity
 * (asserted via the `PATCH` call each control makes), the PDF button's
 * disabled-until-marked gate and its PUT-then-POST-then-open-window flow,
 * the Text Entry navigation link, and the back arrow.
 */

function iteration(overrides: Partial<IterationDTO> = {}): IterationDTO {
  return {
    id: 1,
    projectId: 7,
    seq: 1,
    imagePath: 'projects/7/iterations/1.png',
    accepted: false,
    role: null,
    ...overrides,
  };
}

function renderOutputPane(
  iterations: IterationDTO[],
  onIterationsChange = vi.fn(),
  initialEntries = ['/projects/7'],
) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route
          path="/projects/:id"
          element={
            <OutputPane
              projectId={7}
              projectTitle="Spring Open House Flyer"
              iterations={iterations}
              onIterationsChange={onIterationsChange}
            />
          }
        />
        <Route path="/" element={<p>Project list</p>} />
        <Route path="/projects/:id/postcard" element={<p>Postcard editor</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OutputPane -- vertical, one-per-row gallery (round 1 regression)', () => {
  it('renders one row per iteration, stacked vertically, real images via GET /api/files/*', () => {
    const iterations = [
      iteration({ id: 1, seq: 1, imagePath: 'projects/7/iterations/1.png' }),
      iteration({ id: 2, seq: 2, imagePath: 'projects/7/iterations/2.png' }),
      iteration({ id: 3, seq: 3, imagePath: 'projects/7/iterations/3.png' }),
    ];
    renderOutputPane(iterations);

    const rows = [1, 2, 3].map((id) => screen.getByTestId(`iteration-row-${id}`));
    expect(rows).toHaveLength(3);

    // Vertical stack: the row container is a flex-col list, not a row.
    const list = rows[0].parentElement!;
    expect(list.className).toMatch(/flex-col/);
    expect(list.className).not.toMatch(/flex-row/);

    // Most-recent iteration first: highest seq at the top, regardless of the
    // order the API supplied them in (stakeholder review correction).
    const images = screen.getAllByRole('img');
    expect(images).toHaveLength(3);
    expect(images[0]).toHaveAttribute('src', '/api/files/projects/7/iterations/3.png');
    expect(images[1]).toHaveAttribute('src', '/api/files/projects/7/iterations/2.png');
    expect(images[2]).toHaveAttribute('src', '/api/files/projects/7/iterations/1.png');
  });

  it('orders iterations most-recent-first even when the API returns them ascending', () => {
    const iterations = [
      iteration({ id: 1, seq: 1, imagePath: 'projects/7/iterations/1.png' }),
      iteration({ id: 2, seq: 2, imagePath: 'projects/7/iterations/2.png' }),
      iteration({ id: 3, seq: 3, imagePath: 'projects/7/iterations/3.png' }),
    ];
    renderOutputPane(iterations);
    const images = screen.getAllByRole('img');
    expect(images.map((img) => img.getAttribute('src'))).toEqual([
      '/api/files/projects/7/iterations/3.png',
      '/api/files/projects/7/iterations/2.png',
      '/api/files/projects/7/iterations/1.png',
    ]);
  });

  it('shows "No iterations yet" for an empty gallery, not a broken render', () => {
    renderOutputPane([]);
    expect(screen.getByText('No iterations yet.')).toBeInTheDocument();
  });
});

describe('OutputPane -- media capped at 800x800 and centered (round 9)', () => {
  it('applies an 800px max-height/max-width cap on each iteration image', () => {
    renderOutputPane([iteration()]);
    const img = screen.getByRole('img');
    expect(img.className).toMatch(/max-h-\[800px\]/);
    expect(img.className).toMatch(/max-w-\[800px\]/);
  });

  it('centers each row within the gallery (mx-auto) and centers the image within its row', () => {
    renderOutputPane([iteration()]);
    const row = screen.getByTestId('iteration-row-1');
    expect(row.className).toMatch(/mx-auto/);
    const img = screen.getByRole('img');
    expect(img.className).toMatch(/mx-auto/);
  });
});

describe('OutputPane -- accepted checkbox exclusivity (rounds 6-7)', () => {
  it('PATCHes accepted: true and unchecks the previously-accepted iteration locally', async () => {
    const iterations = [
      iteration({ id: 1, seq: 1, accepted: true }),
      iteration({ id: 2, seq: 2, accepted: false }),
    ];
    const onIterationsChange = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...iterations[1], accepted: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderOutputPane(iterations, onIterationsChange);

    fireEvent.click(screen.getByLabelText('Iteration 2 accepted'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/7/iterations/2',
        expect.objectContaining({
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accepted: true }),
        }),
      );
    });

    await waitFor(() => expect(onIterationsChange).toHaveBeenCalled());
    const next = onIterationsChange.mock.calls[0][0] as IterationDTO[];
    expect(next.find((it) => it.id === 1)!.accepted).toBe(false);
    expect(next.find((it) => it.id === 2)!.accepted).toBe(true);
  });

  it('unchecking sends accepted: false', async () => {
    const iterations = [iteration({ id: 1, seq: 1, accepted: true })];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...iterations[0], accepted: false }) });
    vi.stubGlobal('fetch', fetchMock);

    renderOutputPane(iterations);
    fireEvent.click(screen.getByLabelText('Iteration 1 accepted'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/7/iterations/1',
        expect.objectContaining({ body: JSON.stringify({ accepted: false }) }),
      );
    });
  });

  it('survives a reload: parent-owned state re-renders checked from fresh props', () => {
    const { rerender } = renderOutputPane([iteration({ id: 1, seq: 1, accepted: false })]);
    expect(screen.getByLabelText('Iteration 1 accepted')).not.toBeChecked();

    rerender(
      <MemoryRouter initialEntries={['/projects/7']}>
        <Routes>
          <Route
            path="/projects/:id"
            element={
              <OutputPane
                projectId={7}
                projectTitle="Spring Open House Flyer"
                iterations={[iteration({ id: 1, seq: 1, accepted: true })]}
                onIterationsChange={vi.fn()}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('Iteration 1 accepted')).toBeChecked();
  });
});

describe('OutputPane -- front/back pulldown exclusivity (rounds 6-7)', () => {
  it('PATCHes role: "front" and clears the role from whichever iteration previously held it', async () => {
    const iterations = [
      iteration({ id: 1, seq: 1, role: 'front' }),
      iteration({ id: 2, seq: 2, role: null }),
    ];
    const onIterationsChange = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...iterations[1], role: 'front' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderOutputPane(iterations, onIterationsChange);

    fireEvent.change(screen.getByLabelText('Iteration 2 side'), { target: { value: 'front' } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/7/iterations/2',
        expect.objectContaining({ body: JSON.stringify({ role: 'front' }) }),
      );
    });

    await waitFor(() => expect(onIterationsChange).toHaveBeenCalled());
    const next = onIterationsChange.mock.calls[0][0] as IterationDTO[];
    expect(next.find((it) => it.id === 1)!.role).toBeNull();
    expect(next.find((it) => it.id === 2)!.role).toBe('front');
  });

  it('front and back are independently exclusive -- setting back does not touch front', async () => {
    const iterations = [
      iteration({ id: 1, seq: 1, role: 'front' }),
      iteration({ id: 2, seq: 2, role: 'back' }),
      iteration({ id: 3, seq: 3, role: null }),
    ];
    const onIterationsChange = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...iterations[2], role: 'back' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderOutputPane(iterations, onIterationsChange);
    fireEvent.change(screen.getByLabelText('Iteration 3 side'), { target: { value: 'back' } });

    await waitFor(() => expect(onIterationsChange).toHaveBeenCalled());
    const next = onIterationsChange.mock.calls[0][0] as IterationDTO[];
    expect(next.find((it) => it.id === 1)!.role).toBe('front');
    expect(next.find((it) => it.id === 2)!.role).toBeNull();
    expect(next.find((it) => it.id === 3)!.role).toBe('back');
  });

  it('selecting "—" sends role: null', async () => {
    const iterations = [iteration({ id: 1, seq: 1, role: 'front' })];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...iterations[0], role: null }) });
    vi.stubGlobal('fetch', fetchMock);

    renderOutputPane(iterations);
    fireEvent.change(screen.getByLabelText('Iteration 1 side'), { target: { value: 'none' } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/7/iterations/1',
        expect.objectContaining({ body: JSON.stringify({ role: null }) }),
      );
    });
  });
});

describe('applyIterationPatch (unit)', () => {
  it('clears accepted from every other iteration when one becomes accepted', () => {
    const iterations = [iteration({ id: 1, accepted: true }), iteration({ id: 2, accepted: false })];
    const result = applyIterationPatch(iterations, { ...iterations[1], accepted: true });
    expect(result.find((it) => it.id === 1)!.accepted).toBe(false);
    expect(result.find((it) => it.id === 2)!.accepted).toBe(true);
  });

  it('clears a role from whichever other iteration held it', () => {
    const iterations = [iteration({ id: 1, role: 'back' }), iteration({ id: 2, role: null })];
    const result = applyIterationPatch(iterations, { ...iterations[1], role: 'back' });
    expect(result.find((it) => it.id === 1)!.role).toBeNull();
    expect(result.find((it) => it.id === 2)!.role).toBe('back');
  });
});

describe('OutputPane -- PDF button', () => {
  it('is disabled when no iteration has a marked side', () => {
    renderOutputPane([iteration({ id: 1, role: null })]);
    expect(screen.getByRole('button', { name: 'PDF' })).toBeDisabled();
  });

  it('is enabled once at least one side is marked', () => {
    renderOutputPane([iteration({ id: 1, role: 'front' })]);
    expect(screen.getByRole('button', { name: 'PDF' })).toBeEnabled();
  });

  it('PUTs front/back image paths then POSTs .../pdf, then opens the PDF in a new window', async () => {
    const iterations = [
      iteration({ id: 1, seq: 1, role: 'front', imagePath: 'projects/7/iterations/1.png' }),
      iteration({ id: 2, seq: 2, role: 'back', imagePath: 'projects/7/iterations/2.png' }),
    ];

    const putMock = { ok: true, json: async () => ({}) };
    const pdfBlob = new Blob(['%PDF-1.7 fake'], { type: 'application/pdf' });
    const pdfMock = { ok: true, blob: async () => pdfBlob };
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/postcards/7' && init?.method === 'PUT') return Promise.resolve(putMock as Response);
      if (String(url) === '/api/postcards/7/pdf' && init?.method === 'POST') return Promise.resolve(pdfMock as Response);
      return Promise.resolve({ ok: false, status: 404 } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn().mockReturnValue('blob:fake-pdf-url') });
    const openMock = vi.fn();
    vi.stubGlobal('open', openMock);

    renderOutputPane(iterations);
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/postcards/7',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            front_image: 'projects/7/iterations/1.png',
            back_image: 'projects/7/iterations/2.png',
          }),
        }),
      );
      expect(fetchMock).toHaveBeenCalledWith('/api/postcards/7/pdf', expect.objectContaining({ method: 'POST' }));
      expect(openMock).toHaveBeenCalledWith('blob:fake-pdf-url', '_blank');
    });
  });

  it('surfaces an error rather than silently failing when PDF generation fails', async () => {
    const iterations = [iteration({ id: 1, role: 'front' })];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    renderOutputPane(iterations);
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));

    await screen.findByText(/failed to generate the pdf/i);
  });

  it('merges existing saved regions/QR into the PUT payload rather than clobbering them (OOP data-loss fix, 2026-07-16)', async () => {
    // Regression test for a real data-loss bug: this button used to PUT
    // `{ front_image, back_image }` only, and `PUT /api/postcards/:id`
    // REPLACES the saved content wholesale -- so a stakeholder's
    // already-saved `front_regions`/`back_regions`/`front_qr` were wiped
    // out. This asserts the PUT body still carries them forward.
    const iterations = [
      iteration({ id: 1, seq: 1, role: 'front', imagePath: 'projects/7/iterations/1.png' }),
      iteration({ id: 2, seq: 2, role: 'back', imagePath: 'projects/7/iterations/2.png' }),
    ];
    const existingContent = overlayContentFixture();

    const putMock = { ok: true, json: async () => ({}) };
    const pdfBlob = new Blob(['%PDF-1.7 fake'], { type: 'application/pdf' });
    const pdfMock = { ok: true, blob: async () => pdfBlob };
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u === '/api/postcards/7' && (!init || !init.method)) {
        return Promise.resolve({ ok: true, json: async () => ({ content: existingContent }) } as Response);
      }
      if (u === '/api/postcards/7' && init?.method === 'PUT') return Promise.resolve(putMock as Response);
      if (u === '/api/postcards/7/pdf' && init?.method === 'POST') return Promise.resolve(pdfMock as Response);
      return Promise.resolve({ ok: false, status: 404 } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn().mockReturnValue('blob:fake-pdf-url') });
    vi.stubGlobal('open', vi.fn());

    renderOutputPane(iterations);
    // Let the mount-time overlay GET resolve first -- the fix does its own
    // fresh GET on click regardless, so this just keeps call ordering
    // predictable for the assertions below.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/postcards/7'));

    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        ([u, i]) => String(u) === '/api/postcards/7' && (i as RequestInit | undefined)?.method === 'PUT',
      );
      expect(putCall).toBeTruthy();
    });

    const putCall = fetchMock.mock.calls.find(
      ([u, i]) => String(u) === '/api/postcards/7' && (i as RequestInit | undefined)?.method === 'PUT',
    )!;
    const body = JSON.parse((putCall[1] as RequestInit).body as string);

    // The regression itself: previously-saved regions/QR must survive.
    expect(body.front_regions).toEqual(existingContent.front_regions);
    expect(body.back_regions).toEqual(existingContent.back_regions);
    expect(body.front_qr).toEqual(existingContent.front_qr);
    // Images still come from whichever iterations currently hold the roles.
    expect(body.front_image).toBe('projects/7/iterations/1.png');
    expect(body.back_image).toBe('projects/7/iterations/2.png');
  });
});

/** A `GET /api/postcards/:projectId` "content exists" response body used by
 * the rendered-text-overlay tests below -- one front region, one back
 * region, and a front QR, enough to prove regions/QR route to the
 * correct-role iteration and nowhere else. */
function overlayContentFixture() {
  return {
    front_regions: [
      {
        name: 'front_headline',
        label: 'Headline',
        style: '',
        text: 'FRONT TEXT',
        position: { top: '1.0in', left: '0.5in', width: '3.4in' }, // no height -> auto-flow
        font: { family: 'Arial, sans-serif', size: '24px' },
      },
    ],
    back_regions: [
      {
        name: 'back_body',
        label: 'Body',
        style: '',
        text: 'BACK TEXT',
        position: { top: '0.52in', left: '1.04in', width: '1.46in', height: '0.73in' },
        font: { family: 'Arial, sans-serif', size: '14px' },
      },
    ],
    front_qr: {
      url: 'https://example.org/rsvp',
      position: { top: '1.15in', right: '0.5in', width: '1.5in', height: '1.5in' },
    },
  };
}

/** Stubs the img at `index` (within `screen.getAllByRole('img')`, gallery
 * order) as having rendered at `widthPx` wide, then fires its `load` event
 * -- jsdom performs no real layout, so `IterationImage`'s
 * `getBoundingClientRect()` measurement has to be stubbed by hand to
 * exercise the overlay's scale-to-displayed-size logic. */
function measureImage(index: number, widthPx: number, heightPx = widthPx / 1.5) {
  const img = screen.getAllByRole('img')[index];
  Object.defineProperty(img, 'getBoundingClientRect', {
    value: () => ({ width: widthPx, height: heightPx, top: 0, left: 0, right: widthPx, bottom: heightPx, x: 0, y: 0, toJSON() {} }),
    configurable: true,
  });
  fireEvent.load(img);
  return img;
}

describe('OutputPane -- rendered-text overlay on the gallery (OOP change, 2026-07-15)', () => {
  it('overlays front_regions/front_qr on the role:"front" iteration, scaled to its displayed image size', async () => {
    const iterations = [
      iteration({ id: 1, seq: 1, role: 'front', imagePath: 'projects/7/iterations/1.png' }),
      iteration({ id: 2, seq: 2, role: 'back', imagePath: 'projects/7/iterations/2.png' }),
    ];
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/postcards/7' && (!init || !init.method)) {
        return Promise.resolve({ ok: true, json: async () => ({ content: overlayContentFixture() }) } as Response);
      }
      return Promise.resolve({ ok: false, status: 404 } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderOutputPane(iterations);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/postcards/7'));

    // Gallery order is most-recent-first (seq desc): index 0 is iteration 2
    // (back), index 1 is iteration 1 (front).
    measureImage(1, 600); // front image displayed at 600px wide -> 100px/in

    const frontOverlay = await screen.findByTestId('overlay-region-front_headline');
    expect(frontOverlay).toHaveStyle({ top: '100.00px', left: '50.00px', width: '340.00px' });
    // Height-less -> no explicit height, same auto-flow rule as the editor.
    expect(frontOverlay.style.height).toBe('');
    expect(screen.getByTestId('overlay-region-text-front_headline')).toHaveTextContent('FRONT TEXT');

    const frontQr = screen.getByTestId('overlay-qr');
    expect(frontQr).toHaveStyle({ top: '115.00px', right: '50.00px', width: '150.00px', height: '150.00px' });
    expect(screen.getByTestId('overlay-qr-graphic')).toBeInTheDocument();

    // The back iteration's own overlay never shows front content.
    expect(screen.queryByTestId('overlay-region-back_body')).not.toBeInTheDocument();
  });

  it('overlays back_regions on the role:"back" iteration only, independently scaled to ITS image size', async () => {
    const iterations = [
      iteration({ id: 1, seq: 1, role: 'front', imagePath: 'projects/7/iterations/1.png' }),
      iteration({ id: 2, seq: 2, role: 'back', imagePath: 'projects/7/iterations/2.png' }),
    ];
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/postcards/7' && (!init || !init.method)) {
        return Promise.resolve({ ok: true, json: async () => ({ content: overlayContentFixture() }) } as Response);
      }
      return Promise.resolve({ ok: false, status: 404 } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderOutputPane(iterations);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/postcards/7'));

    // Gallery order is most-recent-first: index 0 is iteration 2 (back).
    measureImage(0, 300); // back image displayed narrower -> 50px/in

    const backOverlay = await screen.findByTestId('overlay-region-back_body');
    expect(backOverlay).toHaveStyle({ top: '26.00px', left: '52.00px', width: '73.00px', height: '36.50px' });
    expect(screen.getByTestId('overlay-region-text-back_body')).toHaveTextContent('BACK TEXT');

    // The front iteration shows no back content, and (no front_qr on this
    // face in this fixture's routing) no QR either.
    expect(screen.queryByTestId('overlay-region-front_headline')).not.toBeInTheDocument();
  });

  it('renders bare images (no overlay) when the project has no saved postcard content', async () => {
    const iterations = [iteration({ id: 1, seq: 1, role: 'front' })];
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/postcards/7' && (!init || !init.method)) {
        return Promise.resolve({ ok: true, json: async () => ({ content: null }) } as Response);
      }
      return Promise.resolve({ ok: false, status: 404 } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderOutputPane(iterations);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/postcards/7'));
    measureImage(0, 600);

    expect(screen.queryByTestId('postcard-overlay')).not.toBeInTheDocument();
  });

  it('renders bare images when the GET /api/postcards/:id request fails (no throw, no error UI)', async () => {
    const iterations = [iteration({ id: 1, seq: 1, role: 'front' })];
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal('fetch', fetchMock);

    renderOutputPane(iterations);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/postcards/7'));
    measureImage(0, 600);

    expect(screen.queryByTestId('postcard-overlay')).not.toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });

  it('a role-less iteration (or one whose face has no saved regions) renders bare, even with content loaded for the OTHER face', async () => {
    const iterations = [
      iteration({ id: 1, seq: 1, role: null }), // no side marked at all
    ];
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/postcards/7' && (!init || !init.method)) {
        return Promise.resolve({ ok: true, json: async () => ({ content: overlayContentFixture() }) } as Response);
      }
      return Promise.resolve({ ok: false, status: 404 } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderOutputPane(iterations);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/postcards/7'));
    measureImage(0, 600);

    expect(screen.queryByTestId('postcard-overlay')).not.toBeInTheDocument();
  });

  it('the overlay carries no editing affordances -- no move-grip labels, no resize handles, no click-to-edit', async () => {
    const iterations = [iteration({ id: 1, seq: 1, role: 'front' })];
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/postcards/7' && (!init || !init.method)) {
        return Promise.resolve({ ok: true, json: async () => ({ content: overlayContentFixture() }) } as Response);
      }
      return Promise.resolve({ ok: false, status: 404 } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderOutputPane(iterations);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/postcards/7'));
    measureImage(0, 600);

    await screen.findByTestId('overlay-region-front_headline');
    // No editor-only affordances anywhere in the gallery.
    expect(screen.queryByTestId('region-move-front_headline')).not.toBeInTheDocument();
    expect(screen.queryByTestId('move-handle-br-front_headline')).not.toBeInTheDocument();
    expect(screen.queryByTestId('move-handle-tl-qr')).not.toBeInTheDocument();
    expect(screen.queryByTestId('move-handle-br-qr')).not.toBeInTheDocument();
    // The overlay is not an interactive button -- no role="button" inside it.
    const overlay = screen.getByTestId('postcard-overlay');
    expect(overlay.querySelector('button')).toBeNull();
    // It never intercepts pointer events, so the row's own controls stay usable.
    expect(overlay.className).toMatch(/pointer-events-none/);

    // Existing gallery controls remain -- this feature only adds an overlay.
    expect(screen.getByLabelText('Iteration 1 accepted')).toBeInTheDocument();
    expect(screen.getByLabelText('Iteration 1 side')).toBeInTheDocument();
  });

  it("applies the region's real font/style and paragraph structure, font.size scaled by widthPx (OOP change, 2026-07-15)", async () => {
    const iterations = [iteration({ id: 1, seq: 1, role: 'front', imagePath: 'projects/7/iterations/1.png' })];
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/postcards/7' && (!init || !init.method)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            content: {
              front_regions: [
                {
                  name: 'front_headline',
                  label: 'Headline',
                  style: 'font-weight:900; color:#CC1616;',
                  text: 'Line one\nLine two\n\nSecond paragraph',
                  position: { top: '1.0in', left: '0.5in', width: '3.4in' },
                  font: { family: 'Arial, sans-serif', size: '34px' },
                },
              ],
              back_regions: [],
            },
          }),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 404 } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderOutputPane(iterations);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/postcards/7'));

    // Displayed at REFERENCE_WIDTH_PX (576px, 6in * 96dpi) -- font.size
    // stays exactly as authored, just formatted to 2 decimal places.
    measureImage(0, 576);
    const textEl576 = await screen.findByTestId('overlay-region-text-front_headline');
    expect(textEl576).toHaveStyle({
      fontFamily: 'Arial, sans-serif',
      fontSize: '34.00px',
      fontWeight: '900',
      color: '#CC1616',
    });
    const paragraphs576 = textEl576.querySelectorAll('p');
    expect(paragraphs576).toHaveLength(2);
    expect(paragraphs576[0].querySelectorAll('br')).toHaveLength(1);
    expect(paragraphs576[0].textContent).toBe('Line oneLine two');
    expect(paragraphs576[1].textContent).toBe('Second paragraph');

    // Displayed at half REFERENCE_WIDTH_PX -- font.size halves too.
    measureImage(0, 288);
    const textEl288 = await screen.findByTestId('overlay-region-text-front_headline');
    expect(textEl288).toHaveStyle({ fontSize: '17.00px' });
  });
});

describe('OutputPane -- delete an iteration, with a confirmation popup (OOP change, 2026-07-15)', () => {
  it('clicking Delete opens the confirmation popup, not an immediate delete', async () => {
    // The component always fires a GET /api/postcards/:id on mount (the
    // rendered-text-overlay hydration, unrelated to this feature) -- stub
    // it so the only thing worth asserting is that opening the popup never
    // fires a DELETE.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: null }) });
    vi.stubGlobal('fetch', fetchMock);

    renderOutputPane([iteration({ id: 1, seq: 1 })]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/postcards/7'));
    fetchMock.mockClear();

    expect(screen.queryByTestId('delete-confirm-1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Delete iteration 1'));

    expect(screen.getByTestId('delete-confirm-1')).toBeInTheDocument();
    expect(screen.getByText('Delete this iteration?')).toBeInTheDocument();
    // No DELETE fired yet -- opening the popup is not itself a delete.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('confirming calls DELETE and removes the row via onIterationsChange', async () => {
    const iterations = [
      iteration({ id: 1, seq: 1 }),
      iteration({ id: 2, seq: 2 }),
    ];
    const onIterationsChange = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    renderOutputPane(iterations, onIterationsChange);
    fireEvent.click(screen.getByLabelText('Delete iteration 1'));

    const popup = screen.getByTestId('delete-confirm-1');
    fireEvent.click(within(popup).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/7/iterations/1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    await waitFor(() => expect(onIterationsChange).toHaveBeenCalled());
    const next = onIterationsChange.mock.calls[0][0] as IterationDTO[];
    expect(next.map((it) => it.id)).toEqual([2]);

    // The popup closes once the delete resolves.
    await waitFor(() => expect(screen.queryByTestId('delete-confirm-1')).not.toBeInTheDocument());
  });

  it('Cancel closes the popup without calling DELETE or touching state', async () => {
    const onIterationsChange = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: null }) });
    vi.stubGlobal('fetch', fetchMock);

    renderOutputPane([iteration({ id: 1, seq: 1 })], onIterationsChange);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/postcards/7'));
    fetchMock.mockClear();

    fireEvent.click(screen.getByLabelText('Delete iteration 1'));

    const popup = screen.getByTestId('delete-confirm-1');
    fireEvent.click(within(popup).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByTestId('delete-confirm-1')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onIterationsChange).not.toHaveBeenCalled();
  });

  it('surfaces an error rather than silently failing when the delete request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    renderOutputPane([iteration({ id: 1, seq: 1 })]);
    fireEvent.click(screen.getByLabelText('Delete iteration 1'));
    fireEvent.click(within(screen.getByTestId('delete-confirm-1')).getByRole('button', { name: 'Delete' }));

    await screen.findByText(/failed to delete iteration/i);
    // The popup still closes even on failure -- the error text is the
    // durable signal, not a stuck-open popup.
    expect(screen.queryByTestId('delete-confirm-1')).not.toBeInTheDocument();
  });
});

describe('OutputPane -- Text Entry navigation', () => {
  it('navigates to /projects/:id/postcard', () => {
    renderOutputPane([iteration()]);
    fireEvent.click(screen.getByRole('link', { name: 'Text Entry' }));
    expect(screen.getByText('Postcard editor')).toBeInTheDocument();
  });
});

describe('OutputPane -- back arrow', () => {
  it('navigates to the project list at /', () => {
    renderOutputPane([iteration()]);
    fireEvent.click(screen.getByRole('link', { name: 'Back to projects' }));
    expect(screen.getByText('Project list')).toBeInTheDocument();
  });
});
