import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import OutputPane, { applyIterationPatch } from '../../client/src/pages/ProjectDetail/OutputPane';
import type { IterationDTO } from '../../client/src/pages/ProjectDetail/types';
import type { UsePostcardEditorStateResult } from '../../client/src/pages/ProjectDetail/usePostcardEditorState';
import type { PostcardRegion, PostcardSide } from '../../client/src/lib/postcardFaceEditing';

/**
 * Coverage for `client/src/pages/ProjectDetail/OutputPane.tsx` (Sprint 005
 * OOP change, 2026-07-15: rebuilt from "one gallery of every iteration"
 * into "one stream per face"). The title/PDF/back-arrow/Text-Entry chrome
 * this file used to test all moved to `ProjectDetail/index.tsx` (its own
 * `ProjectDetail.test.tsx` now covers those); this file is scoped to what
 * `OutputPane` itself still owns: stream filtering by `activeTab`, the
 * Accepted checkbox (still `PATCH`, now per-`(project, role)` exclusive),
 * Delete-with-confirmation, and the inline `PostcardFaceEditor` that
 * replaces a bare image on whichever row is accepted.
 *
 * `OutputPane` is now a pure, controlled component -- it takes
 * `postcardEditor` (the `usePostcardEditorState` hook's return shape) as a
 * prop rather than fetching/owning postcard content itself, so these tests
 * construct a lightweight fake satisfying that interface instead of
 * mounting the real hook.
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

function fakePostcardEditor(overrides: Partial<UsePostcardEditorStateResult> = {}): UsePostcardEditorStateResult {
  const regionsBySide: Record<PostcardSide, PostcardRegion[]> = { front: [], back: [] };
  const qrBySide: Record<PostcardSide, null> = { front: null, back: null };
  return {
    regionsBySide,
    regionText: {},
    qrBySide,
    loaded: true,
    existingRegionNames: new Set(),
    addRegion: vi.fn(),
    setRegionText: vi.fn(),
    setRegionPosition: vi.fn(),
    removeRegion: vi.fn(),
    addQr: vi.fn(),
    setQrUrl: vi.fn(),
    setQrPosition: vi.fn(),
    removeQr: vi.fn(),
    buildContentPayload: vi.fn().mockReturnValue(null),
    flushPendingAutosave: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderOutputPane(
  iterations: IterationDTO[],
  options: {
    onIterationsChange?: ReturnType<typeof vi.fn>;
    activeTab?: PostcardSide;
    postcardEditor?: UsePostcardEditorStateResult;
  } = {},
) {
  const onIterationsChange = options.onIterationsChange ?? vi.fn();
  return render(
    <OutputPane
      projectId={7}
      iterations={iterations}
      activeTab={options.activeTab ?? 'front'}
      onIterationsChange={onIterationsChange}
      postcardEditor={options.postcardEditor ?? fakePostcardEditor()}
    />,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OutputPane -- stream filtering by activeTab', () => {
  it('shows only the active stream\'s iterations, newest-first', () => {
    const iterations = [
      iteration({ id: 1, seq: 1, role: 'front' }),
      iteration({ id: 2, seq: 2, role: 'back' }),
      iteration({ id: 3, seq: 3, role: 'front' }),
    ];
    renderOutputPane(iterations, { activeTab: 'front' });

    const rows = screen.getAllByTestId(/^iteration-row-/);
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual(['iteration-row-3', 'iteration-row-1']);
  });

  it('switching activeTab (a prop change) shows the other stream instead', () => {
    const iterations = [
      iteration({ id: 1, seq: 1, role: 'front' }),
      iteration({ id: 2, seq: 2, role: 'back' }),
    ];
    const { rerender } = render(
      <OutputPane
        projectId={7}
        iterations={iterations}
        activeTab="front"
        onIterationsChange={vi.fn()}
        postcardEditor={fakePostcardEditor()}
      />,
    );
    expect(screen.getByTestId('iteration-row-1')).toBeInTheDocument();
    expect(screen.queryByTestId('iteration-row-2')).not.toBeInTheDocument();

    rerender(
      <OutputPane
        projectId={7}
        iterations={iterations}
        activeTab="back"
        onIterationsChange={vi.fn()}
        postcardEditor={fakePostcardEditor()}
      />,
    );
    expect(screen.queryByTestId('iteration-row-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('iteration-row-2')).toBeInTheDocument();
  });

  it('shows "No <face> iterations yet" for an empty stream, not a broken render', () => {
    renderOutputPane([iteration({ id: 1, role: 'back' })], { activeTab: 'front' });
    expect(screen.getByText('No front iterations yet.')).toBeInTheDocument();
  });

  it('no per-iteration side pulldown -- role is stream membership, not user-editable per row', () => {
    renderOutputPane([iteration({ id: 1, role: 'front' })]);
    expect(screen.queryByLabelText('Iteration 1 side')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});

describe('OutputPane -- single scrollable list, width-fit images (sprint 009 ticket 001)', () => {
  it('renders all iterations of the active stream in one container, newest-first, with no stage/history testids', () => {
    const iterations = [
      iteration({ id: 1, seq: 1, role: 'front' }),
      iteration({ id: 2, seq: 2, role: 'front' }),
      iteration({ id: 3, seq: 3, role: 'front' }),
    ];
    renderOutputPane(iterations, { activeTab: 'front' });

    const list = screen.getByTestId('iteration-list');
    expect(within(list).getByTestId('iteration-row-3')).toBeInTheDocument();
    expect(within(list).getByTestId('iteration-row-2')).toBeInTheDocument();
    expect(within(list).getByTestId('iteration-row-1')).toBeInTheDocument();
    expect(screen.queryByTestId('iteration-stage')).not.toBeInTheDocument();
    expect(screen.queryByTestId('iteration-history')).not.toBeInTheDocument();
  });

  it('renders correctly with a single iteration -- same single-list rendering as with many', () => {
    renderOutputPane([iteration({ id: 1, seq: 1, role: 'front' })], { activeTab: 'front' });
    expect(within(screen.getByTestId('iteration-list')).getByTestId('iteration-row-1')).toBeInTheDocument();
    expect(screen.queryByTestId('iteration-stage')).not.toBeInTheDocument();
    expect(screen.queryByTestId('iteration-history')).not.toBeInTheDocument();
  });

  it('switching activeTab re-computes the single list from the newly filtered stream', () => {
    const iterations = [
      iteration({ id: 1, seq: 1, role: 'front' }),
      iteration({ id: 2, seq: 2, role: 'front' }),
      iteration({ id: 3, seq: 1, role: 'back' }),
      iteration({ id: 4, seq: 2, role: 'back' }),
    ];
    const { rerender } = render(
      <OutputPane
        projectId={7}
        iterations={iterations}
        activeTab="front"
        onIterationsChange={vi.fn()}
        postcardEditor={fakePostcardEditor()}
      />,
    );
    const listFront = screen.getByTestId('iteration-list');
    expect(within(listFront).getByTestId('iteration-row-2')).toBeInTheDocument();
    expect(within(listFront).getByTestId('iteration-row-1')).toBeInTheDocument();

    rerender(
      <OutputPane
        projectId={7}
        iterations={iterations}
        activeTab="back"
        onIterationsChange={vi.fn()}
        postcardEditor={fakePostcardEditor()}
      />,
    );
    const listBack = screen.getByTestId('iteration-list');
    expect(within(listBack).getByTestId('iteration-row-4')).toBeInTheDocument();
    expect(within(listBack).getByTestId('iteration-row-3')).toBeInTheDocument();
  });

  it('every iteration image is width-fit (w-full h-auto), carrying no fixed pixel cap of any kind', () => {
    const iterations = [
      iteration({ id: 1, seq: 1, role: 'front' }),
      iteration({ id: 2, seq: 2, role: 'front' }),
    ];
    renderOutputPane(iterations, { activeTab: 'front' });

    for (const alt of ['Iteration 1', 'Iteration 2']) {
      const img = screen.getByAltText(alt);
      expect(img.className).toContain('w-full');
      expect(img.className).toContain('h-auto');
      expect(img.className).not.toContain('max-h-[800px]');
      expect(img.className).not.toContain('max-w-[800px]');
      expect(img.className).not.toContain('max-h-full');
      expect(img.className).not.toContain('max-w-full');
    }
  });

  it('accept/delete behavior is unchanged for the first row in the list', async () => {
    const iterations = [
      iteration({ id: 1, seq: 1, role: 'front' }),
      iteration({ id: 2, seq: 2, role: 'front' }),
    ];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...iterations[1], accepted: true }) });
    vi.stubGlobal('fetch', fetchMock);
    renderOutputPane(iterations, { activeTab: 'front' });

    // Iteration 2 (seq 2) is the first (newest) row.
    fireEvent.click(screen.getByLabelText('Iteration 2 accepted'));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/7/iterations/2',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ accepted: true }) }),
      );
    });

    fireEvent.click(screen.getByLabelText('Delete iteration 2'));
    expect(screen.getByTestId('delete-confirm-2')).toBeInTheDocument();
  });

  it('accept/delete behavior is unchanged for a later row in the list', async () => {
    const iterations = [
      iteration({ id: 1, seq: 1, role: 'front' }),
      iteration({ id: 2, seq: 2, role: 'front' }),
    ];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...iterations[0], accepted: true }) });
    vi.stubGlobal('fetch', fetchMock);
    renderOutputPane(iterations, { activeTab: 'front' });

    // Iteration 1 (seq 1) is a later (older) row.
    fireEvent.click(screen.getByLabelText('Iteration 1 accepted'));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/7/iterations/1',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ accepted: true }) }),
      );
    });

    fireEvent.click(screen.getByLabelText('Delete iteration 1'));
    expect(screen.getByTestId('delete-confirm-1')).toBeInTheDocument();
  });

  it('the inline PostcardFaceEditor renders correctly when the accepted row is newest in the list', () => {
    const iterations = [
      iteration({ id: 1, seq: 1, role: 'front' }),
      iteration({ id: 2, seq: 2, role: 'front', accepted: true }),
    ];
    renderOutputPane(iterations, { activeTab: 'front' });

    const list = screen.getByTestId('iteration-list');
    expect(within(list).getByTestId('postcard-preview')).toBeInTheDocument();
    expect(within(list).getByAltText('Iteration 1')).toBeInTheDocument();
  });

  it('the inline PostcardFaceEditor renders correctly when the accepted row is older in the list', () => {
    const iterations = [
      iteration({ id: 1, seq: 1, role: 'front', accepted: true }),
      iteration({ id: 2, seq: 2, role: 'front' }),
    ];
    renderOutputPane(iterations, { activeTab: 'front' });

    const list = screen.getByTestId('iteration-list');
    expect(within(list).getByTestId('postcard-preview')).toBeInTheDocument();
    expect(within(list).getByAltText('Iteration 2')).toBeInTheDocument();
  });

  it('non-accepted rows still render the read-only PostcardOverlay against the new width-fit image sizing', () => {
    const editor = fakePostcardEditor({
      regionsBySide: {
        front: [{ name: 'front_headline', label: 'Headline', style: '', position: { top: '1in', left: '0.5in', width: '3.4in' }, font: { family: 'Arial', size: '24px' } }],
        back: [],
      },
      regionText: { front_headline: 'Shared text' },
    });
    const iterations = [
      iteration({ id: 1, seq: 1, role: 'front', accepted: true, imagePath: 'projects/7/iterations/1.png' }),
      iteration({ id: 2, seq: 2, role: 'front', accepted: false, imagePath: 'projects/7/iterations/2.png' }),
    ];
    renderOutputPane(iterations, { activeTab: 'front', postcardEditor: editor });

    const img = screen.getByAltText('Iteration 2');
    Object.defineProperty(img, 'getBoundingClientRect', {
      value: () => ({ width: 600, height: 400, top: 0, left: 0, right: 600, bottom: 400, x: 0, y: 0, toJSON() {} }),
      configurable: true,
    });
    fireEvent.load(img);

    expect(screen.getByTestId('overlay-region-text-front_headline')).toHaveTextContent('Shared text');
    expect(img.className).toContain('w-full');
    expect(img.className).toContain('h-auto');
  });
});

describe('OutputPane -- accepted checkbox, per-(project, role) exclusivity', () => {
  it('PATCHes accepted: true', async () => {
    const iterations = [
      iteration({ id: 1, seq: 1, role: 'front', accepted: true }),
      iteration({ id: 2, seq: 2, role: 'front', accepted: false }),
    ];
    const onIterationsChange = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...iterations[1], accepted: true }) });
    vi.stubGlobal('fetch', fetchMock);

    renderOutputPane(iterations, { onIterationsChange });
    fireEvent.click(screen.getByLabelText('Iteration 2 accepted'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/7/iterations/2',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ accepted: true }) }),
      );
    });
    await waitFor(() => expect(onIterationsChange).toHaveBeenCalled());
    const next = onIterationsChange.mock.calls[0][0] as IterationDTO[];
    expect(next.find((it) => it.id === 1)!.accepted).toBe(false);
    expect(next.find((it) => it.id === 2)!.accepted).toBe(true);
  });

  it('surfaces a patch error rather than silently failing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    renderOutputPane([iteration({ id: 1, role: 'front' })]);
    fireEvent.click(screen.getByLabelText('Iteration 1 accepted'));
    await screen.findByText(/failed to update accepted state/i);
  });
});

describe('applyIterationPatch (unit) -- per-(project, role) accepted exclusivity', () => {
  it('accepting a front-stream iteration clears accepted only from OTHER front-stream iterations', () => {
    const iterations = [
      iteration({ id: 1, role: 'front', accepted: true }),
      iteration({ id: 2, role: 'back', accepted: true }),
      iteration({ id: 3, role: 'front', accepted: false }),
    ];
    const result = applyIterationPatch(iterations, { ...iterations[2], accepted: true });
    expect(result.find((it) => it.id === 1)!.accepted).toBe(false); // same stream -- cleared
    expect(result.find((it) => it.id === 2)!.accepted).toBe(true); // different stream -- untouched
    expect(result.find((it) => it.id === 3)!.accepted).toBe(true);
  });
});

describe('OutputPane -- inline accepted-iteration editor', () => {
  it('the accepted row in the active stream renders PostcardFaceEditor, not a bare image', () => {
    const iterations = [
      iteration({ id: 1, seq: 1, role: 'front', accepted: true, imagePath: 'projects/7/iterations/1.png' }),
      iteration({ id: 2, seq: 2, role: 'front', accepted: false, imagePath: 'projects/7/iterations/2.png' }),
    ];
    renderOutputPane(iterations, { activeTab: 'front' });

    expect(screen.getByTestId('postcard-preview')).toBeInTheDocument();
    expect(screen.getByAltText('front preview')).toHaveAttribute('src', '/api/files/projects/7/iterations/1.png');
    // The non-accepted row still renders as a bare read-only image.
    expect(screen.getByAltText('Iteration 2')).toHaveAttribute('src', '/api/files/projects/7/iterations/2.png');
  });

  it('no accepted iteration in the stream -- every row renders read-only, no editor', () => {
    renderOutputPane([iteration({ id: 1, role: 'front', accepted: false })]);
    expect(screen.queryByTestId('postcard-preview')).not.toBeInTheDocument();
    expect(screen.getByAltText('Iteration 1')).toBeInTheDocument();
  });

  it('editing the accepted iteration\'s text calls the postcardEditor callbacks scoped to the active face', () => {
    const editor = fakePostcardEditor({
      regionsBySide: {
        front: [{ name: 'front_headline', label: 'Headline', style: '', position: { top: '1in', left: '0.5in', width: '3.4in' }, font: { family: 'Arial', size: '24px' } }],
        back: [],
      },
      regionText: { front_headline: 'Hello' },
    });
    renderOutputPane(
      [iteration({ id: 1, role: 'front', accepted: true })],
      { activeTab: 'front', postcardEditor: editor },
    );

    fireEvent.click(screen.getByTestId('postcard-region-box-front_headline'));
    fireEvent.change(screen.getByLabelText('Headline text'), { target: { value: 'Updated' } });
    fireEvent.keyDown(screen.getByLabelText('Headline text'), { key: 'Enter' });

    expect(editor.setRegionText).toHaveBeenCalledWith('front_headline', 'Updated');
  });

  it('non-accepted rows read-only overlay the SAME face regions as the editor (boxes carry over between iterations)', () => {
    const editor = fakePostcardEditor({
      regionsBySide: {
        front: [{ name: 'front_headline', label: 'Headline', style: '', position: { top: '1in', left: '0.5in', width: '3.4in' }, font: { family: 'Arial', size: '24px' } }],
        back: [],
      },
      regionText: { front_headline: 'Shared text' },
    });
    const iterations = [
      iteration({ id: 1, seq: 1, role: 'front', accepted: true, imagePath: 'projects/7/iterations/1.png' }),
      iteration({ id: 2, seq: 2, role: 'front', accepted: false, imagePath: 'projects/7/iterations/2.png' }),
    ];
    renderOutputPane(iterations, { activeTab: 'front', postcardEditor: editor });

    // Iteration 2's bare image -- jsdom performs no real layout, so
    // `IterationImage`'s `useMeasuredWidth` needs its `<img>`'s `load`
    // event fired (with a stubbed rect) before it renders any overlay.
    const img = screen.getByAltText('Iteration 2');
    Object.defineProperty(img, 'getBoundingClientRect', {
      value: () => ({ width: 600, height: 400, top: 0, left: 0, right: 600, bottom: 400, x: 0, y: 0, toJSON() {} }),
      configurable: true,
    });
    fireEvent.load(img);

    // It shows the read-only PostcardOverlay with the identical
    // front_headline text the accepted iteration's editor also shows.
    expect(screen.getByTestId('overlay-region-text-front_headline')).toHaveTextContent('Shared text');
  });
});

describe('OutputPane -- delete an iteration, with a confirmation popup', () => {
  it('clicking Delete opens the confirmation popup, not an immediate delete', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderOutputPane([iteration({ id: 1, seq: 1, role: 'front' })]);

    expect(screen.queryByTestId('delete-confirm-1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Delete iteration 1'));

    expect(screen.getByTestId('delete-confirm-1')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('confirming calls DELETE and removes the row via onIterationsChange', async () => {
    const iterations = [iteration({ id: 1, seq: 1, role: 'front' }), iteration({ id: 2, seq: 2, role: 'front' })];
    const onIterationsChange = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    renderOutputPane(iterations, { onIterationsChange });
    fireEvent.click(screen.getByLabelText('Delete iteration 1'));
    fireEvent.click(within(screen.getByTestId('delete-confirm-1')).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/projects/7/iterations/1', expect.objectContaining({ method: 'DELETE' }));
    });
    await waitFor(() => expect(onIterationsChange).toHaveBeenCalled());
    expect((onIterationsChange.mock.calls[0][0] as IterationDTO[]).map((it) => it.id)).toEqual([2]);
  });

  it('Cancel closes the popup without calling DELETE', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderOutputPane([iteration({ id: 1, seq: 1, role: 'front' })]);

    fireEvent.click(screen.getByLabelText('Delete iteration 1'));
    fireEvent.click(within(screen.getByTestId('delete-confirm-1')).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByTestId('delete-confirm-1')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces an error rather than silently failing when the delete request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    renderOutputPane([iteration({ id: 1, seq: 1, role: 'front' })]);

    fireEvent.click(screen.getByLabelText('Delete iteration 1'));
    fireEvent.click(within(screen.getByTestId('delete-confirm-1')).getByRole('button', { name: 'Delete' }));

    await screen.findByText(/failed to delete iteration/i);
    expect(screen.queryByTestId('delete-confirm-1')).not.toBeInTheDocument();
  });
});
