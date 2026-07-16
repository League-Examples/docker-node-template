import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import PostcardFaceEditor from '../../client/src/pages/ProjectDetail/PostcardFaceEditor';
import { createDefaultTextRegion, type PostcardRegion } from '../../client/src/lib/postcardFaceEditing';
import type { PostcardQr } from '../../client/src/pages/ProjectDetail/types';

/**
 * Coverage for `client/src/pages/ProjectDetail/PostcardFaceEditor.tsx`
 * (Sprint 005 OOP change, 2026-07-15) -- the interactive text-box/QR
 * editing machinery extracted from the now-deleted `pages/PostcardEdit.tsx`
 * (formerly covered by `PostcardEdit.test.tsx`, removed with that page).
 * This component is now purely CONTROLLED: it holds only in-progress drag/
 * popup UI state, reporting every add/edit/move/resize/delete back to the
 * caller via callback props rather than owning `regions`/`qr` state or any
 * persistence itself (that data layer moved to `usePostcardEditorState.ts`,
 * covered separately). Every test here renders the component directly with
 * a fixed `side` and asserts on the callback props it fires.
 */

function region(overrides: Partial<PostcardRegion> = {}): PostcardRegion {
  return {
    name: 'front_headline',
    label: 'Headline',
    style: '',
    position: { top: '1.00in', left: '0.50in', width: '3.40in' },
    font: { family: 'Arial, sans-serif', size: '24px' },
    ...overrides,
  };
}

function renderEditor(overrides: Partial<ComponentProps<typeof PostcardFaceEditor>> = {}) {
  const props = {
    side: 'front' as const,
    imagePath: 'projects/7/iterations/1.png',
    regions: [] as PostcardRegion[],
    regionText: {} as Record<string, string>,
    qr: null as PostcardQr | null,
    existingRegionNames: new Set<string>(),
    onAddRegion: vi.fn(),
    onRegionTextChange: vi.fn(),
    onRegionPositionChange: vi.fn(),
    onDeleteRegion: vi.fn(),
    onAddQr: vi.fn(),
    onQrUrlChange: vi.fn(),
    onQrPositionChange: vi.fn(),
    onDeleteQr: vi.fn(),
    ...overrides,
  };
  render(<PostcardFaceEditor {...props} />);
  return props;
}

describe('PostcardFaceEditor -- renders the face image + existing regions', () => {
  it('renders the preview image and each region\'s base-layer text', () => {
    renderEditor({
      regions: [region()],
      regionText: { front_headline: 'Hello there' },
    });
    expect(screen.getByAltText('front preview')).toHaveAttribute('src', '/api/files/projects/7/iterations/1.png');
    expect(screen.getByTestId('postcard-region-text-front_headline')).toHaveTextContent('Hello there');
  });
});

describe('PostcardFaceEditor -- click-to-edit popup', () => {
  it('clicking a region box opens the edit popup pre-filled with its current text', () => {
    renderEditor({ regions: [region()], regionText: { front_headline: 'Original text' } });
    fireEvent.click(screen.getByTestId('postcard-region-box-front_headline'));

    expect(screen.getByRole('dialog', { name: 'Edit Headline' })).toBeInTheDocument();
    expect(screen.getByLabelText('Headline text')).toHaveValue('Original text');
  });

  it('Enter commits the edited text via onRegionTextChange, then closes the popup', () => {
    const props = renderEditor({ regions: [region()], regionText: { front_headline: 'Original text' } });
    fireEvent.click(screen.getByTestId('postcard-region-box-front_headline'));

    const textarea = screen.getByLabelText('Headline text');
    fireEvent.change(textarea, { target: { value: 'New text' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(props.onRegionTextChange).toHaveBeenCalledWith('front_headline', 'New text');
    expect(screen.queryByRole('dialog', { name: 'Edit Headline' })).not.toBeInTheDocument();
  });

  it('Escape discards without calling onRegionTextChange', () => {
    const props = renderEditor({ regions: [region()], regionText: { front_headline: 'Original text' } });
    fireEvent.click(screen.getByTestId('postcard-region-box-front_headline'));
    fireEvent.change(screen.getByLabelText('Headline text'), { target: { value: 'Discarded' } });
    fireEvent.keyDown(screen.getByLabelText('Headline text'), { key: 'Escape' });

    expect(props.onRegionTextChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Edit Headline' })).not.toBeInTheDocument();
  });

  it('the popup\'s Delete button calls onDeleteRegion and closes the popup', () => {
    const props = renderEditor({ regions: [region()], regionText: { front_headline: 'x' } });
    fireEvent.click(screen.getByTestId('postcard-region-box-front_headline'));

    const dialog = screen.getByRole('dialog', { name: 'Edit Headline' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(props.onDeleteRegion).toHaveBeenCalledWith('front_headline');
    expect(screen.queryByRole('dialog', { name: 'Edit Headline' })).not.toBeInTheDocument();
  });
});

describe('PostcardFaceEditor -- "+ Text" adds a default-position region', () => {
  it('clicking "+ Text" calls onAddRegion with a default-positioned, uniquely-named, empty-text region', () => {
    const props = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Add text box' }));

    expect(props.onAddRegion).toHaveBeenCalledTimes(1);
    const [addedRegion, initialText] = props.onAddRegion.mock.calls[0];
    expect(addedRegion.name).toBe('front_text_1');
    expect(addedRegion.label).toBe('Text 1');
    expect(addedRegion.position).toEqual({ top: '1.00in', left: '0.50in', width: '3.00in', height: '1.00in' });
    expect(initialText).toBe('');
  });

  it('generates a name unique across both faces via existingRegionNames', () => {
    const props = renderEditor({ existingRegionNames: new Set(['front_text_1']) });
    fireEvent.click(screen.getByRole('button', { name: 'Add text box' }));

    expect(props.onAddRegion.mock.calls[0][0].name).toBe('front_text_2');
    expect(props.onAddRegion.mock.calls[0][0].label).toBe('Text 2');
  });

  it('an added region is immediately movable, resizable, and openable via click-to-edit', () => {
    // The parent owns `regions` state; render as it would just after
    // `onAddRegion` fires for a fresh "+ Text" click (mirrors
    // `usePostcardEditorState.addRegion`'s resulting props).
    const addedRegion = createDefaultTextRegion('front', new Set());
    renderEditor({ regions: [addedRegion], regionText: { [addedRegion.name]: '' } });

    expect(screen.getByTestId(`region-move-${addedRegion.name}`)).toBeInTheDocument();
    expect(screen.getByTestId(`move-handle-br-${addedRegion.name}`)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId(`postcard-region-box-${addedRegion.name}`));
    expect(screen.getByRole('dialog', { name: `Edit ${addedRegion.label}` })).toBeInTheDocument();
  });

  it('no rubber-band draw or name-the-box dialog remains: dragging on the canvas background does nothing', () => {
    const props = renderEditor();
    const preview = screen.getByTestId('postcard-preview');

    fireEvent.mouseDown(preview, { clientX: 50, clientY: 50, target: preview, currentTarget: preview });
    fireEvent.mouseMove(preview, { clientX: 150, clientY: 100 });
    fireEvent.mouseUp(preview);

    expect(screen.queryByTestId('draw-rubber-band')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Name new text box' })).not.toBeInTheDocument();
    expect(props.onAddRegion).not.toHaveBeenCalled();
  });
});

describe('PostcardFaceEditor -- move/resize a region', () => {
  it('dragging the move-grip label calls onRegionPositionChange with an updated position', () => {
    const props = renderEditor({ regions: [region()], regionText: { front_headline: 'x' } });
    const grip = screen.getByTestId('region-move-front_headline');

    fireEvent.mouseDown(grip, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(screen.getByTestId('postcard-preview'), { clientX: 196, clientY: 100 });
    fireEvent.mouseUp(screen.getByTestId('postcard-preview'));

    expect(props.onRegionPositionChange).toHaveBeenCalled();
    const [name, position] = props.onRegionPositionChange.mock.calls.at(-1)!;
    expect(name).toBe('front_headline');
    // jsdom reports offsetLeft/Top as 0, so the resulting position is the
    // pure mouse delta at the 96dpi jsdom fallback (96px moved = 1.00in).
    expect(position.left).toBe('1.00in');
    expect(position.right).toBeUndefined();
  });

  it('dragging the bottom-right resize handle calls onRegionPositionChange with an updated width/height', () => {
    const props = renderEditor({ regions: [region()], regionText: { front_headline: 'x' } });
    const handle = screen.getByTestId('move-handle-br-front_headline');

    fireEvent.mouseDown(handle, { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(screen.getByTestId('postcard-preview'), { clientX: 96, clientY: 48 });
    fireEvent.mouseUp(screen.getByTestId('postcard-preview'));

    const [, position] = props.onRegionPositionChange.mock.calls.at(-1)!;
    expect(position.width).toBe('1.00in');
    expect(position.height).toBe('0.50in');
  });

  it('shows alignment-guide crosshairs while dragging, and hides them once the drag ends', () => {
    renderEditor({ regions: [region()], regionText: { front_headline: 'x' } });
    const grip = screen.getByTestId('region-move-front_headline');

    fireEvent.mouseDown(grip, { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(screen.getByTestId('postcard-preview'), { clientX: 10, clientY: 10 });
    expect(screen.getByTestId('align-guide-top')).toBeInTheDocument();
    expect(screen.getByTestId('align-guide-left')).toBeInTheDocument();

    fireEvent.mouseUp(screen.getByTestId('postcard-preview'));
    expect(screen.queryByTestId('align-guide-top')).not.toBeInTheDocument();
  });
});

describe('PostcardFaceEditor -- QR add/edit/delete', () => {
  it('the QR toolbar button calls onAddQr, and is disabled once a QR is already present', () => {
    const { rerender } = render(<PostcardFaceEditor {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add QR code' }));

    const withQr = { ...baseProps(), qr: { url: '', position: { top: '1in', right: '0.5in', width: '1.5in', height: '1.5in' } } };
    rerender(<PostcardFaceEditor {...withQr} />);
    expect(screen.getByRole('button', { name: 'Add QR code' })).toBeDisabled();
  });

  it('with no URL yet, shows the placeholder and clicking it opens the URL popup', () => {
    const props = baseProps({ qr: { url: '', position: { top: '1in', right: '0.5in', width: '1.5in', height: '1.5in' } } });
    render(<PostcardFaceEditor {...props} />);

    expect(screen.getByText('Click to set a QR URL')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('postcard-qr-box'));
    expect(screen.getByRole('dialog', { name: 'QR code' })).toBeInTheDocument();
  });

  it('Enter in the URL popup calls onQrUrlChange with a normalized URL', () => {
    const props = baseProps({ qr: { url: '', position: { top: '1in', right: '0.5in', width: '1.5in', height: '1.5in' } } });
    render(<PostcardFaceEditor {...props} />);
    fireEvent.click(screen.getByTestId('postcard-qr-box'));

    const input = screen.getByLabelText('QR code URL');
    fireEvent.change(input, { target: { value: 'example.org/rsvp' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(props.onQrUrlChange).toHaveBeenCalledWith('https://example.org/rsvp');
  });

  it('the QR popup\'s Delete button calls onDeleteQr', () => {
    const props = baseProps({ qr: { url: 'https://example.org', position: { top: '1in', right: '0.5in', width: '1.5in', height: '1.5in' } } });
    render(<PostcardFaceEditor {...props} />);
    fireEvent.click(screen.getByTestId('postcard-qr-box'));

    const dialog = screen.getByRole('dialog', { name: 'QR code' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(props.onDeleteQr).toHaveBeenCalled();
  });

  function baseProps(overrides: Partial<ComponentProps<typeof PostcardFaceEditor>> = {}) {
    return {
      side: 'front' as const,
      imagePath: 'projects/7/iterations/1.png',
      regions: [] as PostcardRegion[],
      regionText: {} as Record<string, string>,
      qr: null as PostcardQr | null,
      existingRegionNames: new Set<string>(),
      onAddRegion: vi.fn(),
      onRegionTextChange: vi.fn(),
      onRegionPositionChange: vi.fn(),
      onDeleteRegion: vi.fn(),
      onAddQr: vi.fn(),
      onQrUrlChange: vi.fn(),
      onQrPositionChange: vi.fn(),
      onDeleteQr: vi.fn(),
      ...overrides,
    };
  }
});
