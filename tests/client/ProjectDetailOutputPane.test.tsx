import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
