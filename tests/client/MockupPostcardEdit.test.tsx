import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import MockupPostcardEdit from '../../client/src/pages/mockups/MockupPostcardEdit';

function renderPage() {
  return render(
    <MemoryRouter>
      <MockupPostcardEdit />
    </MemoryRouter>,
  );
}

describe('MockupPostcardEdit', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the stub regions on the postcard with their text', () => {
    renderPage();

    expect(screen.getByTestId('postcard-region-box-back_headline')).toBeInTheDocument();
    expect(screen.getByTestId('postcard-region-text-back_headline')).toHaveTextContent(
      /robot riot/i,
    );
    expect(screen.getByTestId('postcard-region-text-back_datetime')).toHaveTextContent(
      /saturday, july 11/i,
    );
    // The separate text-field list below the postcard is gone (round 10).
    expect(screen.queryByText(/regions —/i)).not.toBeInTheDocument();
  });

  it('switches to the front side on tab click, and back again', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByTestId('postcard-region-box-back_headline')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^front$/i }));
    expect(screen.queryByTestId('postcard-region-box-back_headline')).not.toBeInTheDocument();
    expect(screen.getByText(/front image only/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.getByTestId('postcard-region-box-back_headline')).toBeInTheDocument();
  });

  it('renders the QR/extra_html placeholder box on the back side, distinguishable from text regions', () => {
    renderPage();

    const overlay = screen.getByTestId('postcard-extra-overlay');
    expect(overlay).toBeInTheDocument();
    expect(within(overlay).getByText(/qr code overlay/i)).toBeInTheDocument();

    const preview = screen.getByTestId('postcard-preview');
    expect(within(preview).getByTestId('postcard-region-box-back_headline')).toBeInTheDocument();
    expect(overlay).not.toBe(within(preview).getByTestId('postcard-region-box-back_headline'));
  });

  it('clicking a region opens a popup; editing and pressing Return updates the preview', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('postcard-region-box-back_headline'));

    const dialog = screen.getByRole('dialog', { name: /edit headline/i });
    expect(dialog).toBeInTheDocument();

    const popupInput = within(dialog).getByLabelText(/headline text/i);
    await user.clear(popupInput);
    await user.type(popupInput, 'CLICKED AND EDITED{Enter}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('postcard-region-text-back_headline')).toHaveTextContent(
      'CLICKED AND EDITED',
    );
  });

  it('Escape closes the popup without applying the draft', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('postcard-region-box-back_headline'));
    const dialog = screen.getByRole('dialog', { name: /edit headline/i });
    const popupInput = within(dialog).getByLabelText(/headline text/i);
    await user.clear(popupInput);
    await user.type(popupInput, 'DISCARD ME{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('postcard-region-text-back_headline')).toHaveTextContent(
      /robot riot/i,
    );
  });

  it('clicking the QR box opens a URL popup; Return sets the QR URL', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('postcard-extra-overlay'));

    const dialog = screen.getByRole('dialog', { name: /set qr code url/i });
    const urlInput = within(dialog).getByLabelText(/qr code url/i);
    await user.clear(urlInput);
    await user.type(urlInput, 'https://example.org/signup{Enter}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('postcard-qr-url')).toHaveTextContent(
      'https://example.org/signup',
    );
  });

  it('dragging on the postcard draws a box; naming it creates a region at the exact drawn size', async () => {
    const user = userEvent.setup();
    renderPage();

    const preview = screen.getByTestId('postcard-preview');
    fireEvent.mouseDown(preview, { clientX: 100, clientY: 50 });
    fireEvent.mouseMove(preview, { clientX: 240, clientY: 120 });
    expect(screen.getByTestId('draw-rubber-band')).toBeInTheDocument();
    fireEvent.mouseUp(preview);

    const dialog = screen.getByRole('dialog', { name: /name new text box/i });
    const nameInput = within(dialog).getByLabelText(/text box name/i);
    await user.type(nameInput, 'Tagline{Enter}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const box = screen.getByTestId('postcard-region-box-back_tagline');
    // Exact drawn size (jsdom fallback: 96px/in): (240-100)x(120-50) from (100,50).
    expect(box).toHaveStyle({
      left: '1.04in',
      top: '0.52in',
      width: '1.46in',
      height: '0.73in',
    });
  });

  it('dragging a corner handle moves the box', () => {
    renderPage();

    const preview = screen.getByTestId('postcard-preview');
    fireEvent.mouseDown(screen.getByTestId('move-handle-tr-back_headline'), {
      clientX: 500,
      clientY: 200,
    });
    fireEvent.mouseMove(preview, { clientX: 550, clientY: 230 });
    fireEvent.mouseUp(preview);

    expect(screen.getByTestId('postcard-region-box-back_headline')).toHaveStyle({
      left: '0.52in',
      top: '0.31in',
    });
  });

  it('the region popup has a Delete button that removes the box', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('postcard-region-box-back_headline'));
    const dialog = screen.getByRole('dialog', { name: /edit headline/i });
    await user.click(within(dialog).getByRole('button', { name: /delete/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('postcard-region-box-back_headline')).not.toBeInTheDocument();
  });

  it('has a back link to the iterations view', () => {
    renderPage();
    expect(screen.getByRole('link', { name: /back to iterations/i })).toHaveAttribute(
      'href',
      '/mockups/main',
    );
  });

  it('shows the chat box with the postcard exchange', () => {
    renderPage();

    expect(screen.getByPlaceholderText(/message claude/i)).toBeInTheDocument();
    expect(screen.getByText(/move the qr code down/i)).toBeInTheDocument();
  });

  it('Generate PDF opens a print window with both sides and popup-edited text', async () => {
    const user = userEvent.setup();

    const docWrite = vi.fn();
    const docClose = vi.fn();
    const openMock = vi.fn(() => ({
      document: { write: docWrite, close: docClose },
    }));
    vi.stubGlobal('open', openMock);

    renderPage();

    // Edit the headline via its popup, then generate.
    await user.click(screen.getByTestId('postcard-region-box-back_headline'));
    const dialog = screen.getByRole('dialog', { name: /edit headline/i });
    const popupInput = within(dialog).getByLabelText(/headline text/i);
    await user.clear(popupInput);
    await user.type(popupInput, 'PDF HEADLINE{Enter}');

    await user.click(screen.getByRole('button', { name: /generate pdf/i }));

    expect(openMock).toHaveBeenCalledOnce();
    const html = docWrite.mock.calls[0][0] as string;
    expect(html).toContain('size: 6in 4in');
    expect((html.match(/class="page"/g) ?? []).length).toBe(2);
    expect(html).toContain('PDF HEADLINE');
    expect(html).toContain('window.print()');
    expect(docClose).toHaveBeenCalledOnce();
  });
});
