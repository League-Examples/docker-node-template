import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EditableProjectTitle from '../../client/src/pages/ProjectDetail/EditableProjectTitle';

/**
 * Coverage for `client/src/pages/ProjectDetail/EditableProjectTitle.tsx`
 * (ticket 013-003, SUC-026, `edit-project-title-inline.md`): the inline
 * click-to-edit control that replaces `index.tsx`'s former static
 * `<h1>{project.title}</h1>` header-row render (the issue's stated file,
 * `ProjectDetailsHeader.tsx`, never rendered `project.title` at all --
 * sprint.md's Codebase Alignment). `ProjectDetail.test.tsx`'s existing
 * page-level tests cover that this renders inside the real page; this file
 * isolates the component itself, mirroring
 * `ProjectDetailReferenceStrip.test.tsx`'s pattern.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderTitle(
  overrides: Partial<{
    title: string;
    version: number;
    onSaved: (next: { title: string; version: number }) => void;
  }> = {},
) {
  const onSaved = overrides.onSaved ?? vi.fn();
  render(
    <EditableProjectTitle
      projectId={7}
      title={overrides.title ?? 'Spring Open House Flyer'}
      version={overrides.version ?? 3}
      onSaved={onSaved}
    />,
  );
  return { onSaved };
}

describe('EditableProjectTitle -- static render', () => {
  it('renders the title as static text, not an input, until clicked', () => {
    renderTitle();
    expect(screen.getByTestId('project-title')).toHaveTextContent('Spring Open House Flyer');
    expect(screen.queryByTestId('project-title-input')).not.toBeInTheDocument();
  });
});

describe('EditableProjectTitle -- click to edit', () => {
  it('clicking the title makes it editable, pre-filled with the current title', () => {
    renderTitle();
    fireEvent.click(screen.getByTestId('project-title'));

    const input = screen.getByTestId('project-title-input') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('Spring Open House Flyer');
  });
});

describe('EditableProjectTitle -- confirming an edit', () => {
  it('Enter calls PATCH with the new title and the current version, and updates the rendered title on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 7, title: 'Autumn Fest Flyer', version: 4 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { onSaved } = renderTitle({ version: 3 });

    fireEvent.click(screen.getByTestId('project-title'));
    const input = screen.getByTestId('project-title-input');
    fireEvent.change(input, { target: { value: 'Autumn Fest Flyer' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/projects/7', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Autumn Fest Flyer', version: 3 }),
      }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ title: 'Autumn Fest Flyer', version: 4 }));

    // Edit mode already closed synchronously on Enter, before the fetch
    // resolves -- no full page reload, just the local state update above.
    expect(screen.queryByTestId('project-title-input')).not.toBeInTheDocument();
  });

  it('blur (without pressing Enter) also confirms the edit', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 7, title: 'Blurred Save', version: 4 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { onSaved } = renderTitle();

    fireEvent.click(screen.getByTestId('project-title'));
    const input = screen.getByTestId('project-title-input');
    fireEvent.change(input, { target: { value: 'Blurred Save' } });
    fireEvent.blur(input);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ title: 'Blurred Save', version: 4 }));
  });

  it('does not call PATCH (or onSaved) when the confirmed text is unchanged from the current title', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { onSaved } = renderTitle({ title: 'Same Title' });

    fireEvent.click(screen.getByTestId('project-title'));
    fireEvent.keyDown(screen.getByTestId('project-title-input'), { key: 'Enter' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByTestId('project-title')).toHaveTextContent('Same Title');
  });
});

describe('EditableProjectTitle -- cancel', () => {
  it('Escape reverts the field to the original title and makes no network call', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderTitle({ title: 'Original Title' });

    fireEvent.click(screen.getByTestId('project-title'));
    const input = screen.getByTestId('project-title-input');
    fireEvent.change(input, { target: { value: 'Never Saved' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('project-title-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('project-title')).toHaveTextContent('Original Title');
  });
});

describe('EditableProjectTitle -- 409 conflict', () => {
  it('reverts the displayed title and surfaces a plain error on a 409 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409 });
    vi.stubGlobal('fetch', fetchMock);
    const { onSaved } = renderTitle({ title: 'Last Known Good' });

    fireEvent.click(screen.getByTestId('project-title'));
    const input = screen.getByTestId('project-title-input');
    fireEvent.change(input, { target: { value: 'Conflicting Edit' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await screen.findByTestId('project-title-error');
    expect(screen.getByTestId('project-title')).toHaveTextContent('Last Known Good');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('surfaces a plain error on a non-409 failure response too', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal('fetch', fetchMock);
    renderTitle();

    fireEvent.click(screen.getByTestId('project-title'));
    const input = screen.getByTestId('project-title-input');
    fireEvent.change(input, { target: { value: 'Whatever' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await screen.findByTestId('project-title-error');
  });
});
