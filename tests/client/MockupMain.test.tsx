import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MockupMain from '../../client/src/pages/mockups/MockupMain';

function renderMain() {
  return render(
    <MemoryRouter>
      <MockupMain />
    </MemoryRouter>,
  );
}

function openLibrary() {
  fireEvent.click(screen.getByRole('button', { name: /open library/i }));
}

function expectDrawerOpen(open: boolean) {
  expect(screen.getByTestId('library-overlay')).toHaveAttribute(
    'data-open',
    String(open),
  );
}

describe('MockupMain', () => {
  it('renders a top bar with a hamburger menu instead of a sidebar', () => {
    renderMain();
    const menuButton = screen.getByRole('button', { name: /menu/i });
    expect(menuButton).toBeInTheDocument();

    fireEvent.click(menuButton);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Log out')).toBeInTheDocument();
  });

  it('starts with the asset browser drawer closed, pull tab showing', () => {
    renderMain();
    expectDrawerOpen(false);
    expect(screen.getByRole('button', { name: /open library/i })).toBeInTheDocument();
  });

  it('slides the drawer open via the pull tab and closed again', () => {
    renderMain();
    openLibrary();
    expectDrawerOpen(true);
    expect(screen.getByRole('button', { name: 'Assets' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Examples' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /close library/i }));
    expectDrawerOpen(false);
  });

  it('switches the visible library list when a category tab is clicked', () => {
    renderMain();
    openLibrary();

    fireEvent.click(screen.getByRole('button', { name: 'Styles' }));
    expect(screen.getByText('Pop Art')).toBeInTheDocument();
    expect(screen.queryByText(/league robot logo/i)).not.toBeInTheDocument();
  });

  it('double-clicking an item adds it as a project reference and closes the drawer', () => {
    renderMain();
    openLibrary();

    fireEvent.doubleClick(screen.getByText(/league robot logo/i));

    expectDrawerOpen(false);
    const chips = screen.getByTestId('project-references');
    expect(chips).toHaveTextContent(/league robot logo/i);
  });

  it('renders the project output area with iteration placeholders', () => {
    renderMain();
    expect(screen.getByRole('heading', { name: /spring open house flyer/i })).toBeInTheDocument();
    expect(screen.getByText('Iteration 1')).toBeInTheDocument();
    expect(screen.getByText('Iteration 3')).toBeInTheDocument();
    expect(screen.getByText('current')).toBeInTheDocument();
  });

  it('works from the last iteration until one is accepted; accepting is exclusive', () => {
    renderMain();
    expect(screen.getByTestId('working-from')).toHaveTextContent(
      /iteration 3 \(last — nothing accepted\)/i,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /iteration 1 accepted/i }));
    expect(screen.getByTestId('working-from')).toHaveTextContent(/iteration 1 \(accepted\)/i);

    fireEvent.click(screen.getByRole('checkbox', { name: /iteration 2 accepted/i }));
    expect(screen.getByRole('checkbox', { name: /iteration 1 accepted/i })).not.toBeChecked();
    expect(screen.getByTestId('working-from')).toHaveTextContent(/iteration 2 \(accepted\)/i);
  });

  it('marking a new iteration as front releases the previous front', () => {
    renderMain();
    // Stub starts with iteration 2 as the front.
    expect(screen.getByTestId('role-badge-iter-002')).toHaveTextContent(/front/i);

    fireEvent.change(screen.getByRole('combobox', { name: /iteration 3 side/i }), {
      target: { value: 'front' },
    });

    expect(screen.getByTestId('role-badge-iter-003')).toHaveTextContent(/front/i);
    expect(screen.queryByTestId('role-badge-iter-002')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /iteration 2 side/i })).toHaveValue('none');
  });

  it('renders the chat panel below the output area', () => {
    renderMain();
    expect(screen.getByPlaceholderText(/message claude/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  });

  it('has a back arrow to projects and a Text Entry link to the postcard view', () => {
    renderMain();
    expect(screen.getByRole('link', { name: /back to projects/i })).toHaveAttribute(
      'href',
      '/mockups/projects',
    );
    expect(screen.getByRole('link', { name: /text entry/i })).toHaveAttribute(
      'href',
      '/mockups/postcard-edit',
    );
  });

  it('PDF button prints only the marked sides', () => {
    const docWrite = vi.fn();
    const openMock = vi.fn(() => ({
      document: { write: docWrite, close: vi.fn() },
    }));
    vi.stubGlobal('open', openMock);

    renderMain();

    // Stub starts with only iteration 2 marked as the front.
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    let html = docWrite.mock.calls[0][0] as string;
    expect(html).toContain('FRONT — Iteration 2');
    expect(html).not.toContain('BACK');

    // Mark a back side too; now both pages print.
    fireEvent.change(screen.getByRole('combobox', { name: /iteration 3 side/i }), {
      target: { value: 'back' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    html = docWrite.mock.calls[1][0] as string;
    expect(html).toContain('FRONT — Iteration 2');
    expect(html).toContain('BACK — Iteration 3');

    vi.unstubAllGlobals();
  });
});
