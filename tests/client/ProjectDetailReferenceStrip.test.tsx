import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ReferenceStrip from '../../client/src/pages/ProjectDetail/ReferenceStrip';
import type { ReferenceDTO } from '../../client/src/pages/ProjectDetail/types';

/**
 * Coverage for `client/src/pages/ProjectDetail/ReferenceStrip.tsx` (ticket
 * 010): extracted out of `ProjectDetail/index.tsx` (ticket 005-009) so
 * `LibraryDrawer.tsx`'s double-click-add path and this component's X-to-
 * remove path can both drive the same reference list without duplicating
 * the render logic. Behavior is unchanged from the inline version --
 * `ProjectDetail.test.tsx`'s existing reference-strip tests cover the
 * full-page wiring; this file isolates the component itself.
 */

function reference(overrides: Partial<ReferenceDTO> = {}): ReferenceDTO {
  return {
    id: 100,
    projectId: 7,
    assetId: 5,
    role: 'style',
    asset: { id: 5, path: 'assets/logo-robot.png' },
    ...overrides,
  };
}

describe('ReferenceStrip', () => {
  it('renders nothing when there are no references', () => {
    render(<ReferenceStrip references={[]} onRemove={vi.fn()} />);
    expect(screen.queryByTestId('project-references')).not.toBeInTheDocument();
  });

  it('renders each reference as an image thumbnail with an X, never a text lozenge (SUC-003)', () => {
    render(<ReferenceStrip references={[reference()]} onRemove={vi.fn()} />);

    const strip = screen.getByTestId('project-references');
    const img = strip.querySelector('img');
    expect(img).toHaveAttribute('src', '/api/files/assets/logo-robot.png');
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
  });

  it('falls back to a gray placeholder (not a crash) when the nested asset is missing', () => {
    render(<ReferenceStrip references={[reference({ asset: null })]} onRemove={vi.fn()} />);
    const strip = screen.getByTestId('project-references');
    expect(strip.querySelector('img')).not.toBeInTheDocument();
    expect(strip.textContent).toContain('style');
  });

  it('clicking the X calls onRemove with the reference id', () => {
    const onRemove = vi.fn();
    render(<ReferenceStrip references={[reference({ id: 42 })]} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onRemove).toHaveBeenCalledWith(42);
  });
});
