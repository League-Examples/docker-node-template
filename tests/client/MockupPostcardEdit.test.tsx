import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MockupPostcardEdit from '../../client/src/pages/mockups/MockupPostcardEdit';

describe('MockupPostcardEdit', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders at least 3 labeled region inputs pre-filled with stub text on the default (back) side', () => {
    render(<MockupPostcardEdit />);

    const headline = screen.getByLabelText(/headline/i, { selector: 'input' }) as HTMLInputElement;
    const datetime = screen.getByLabelText(/date & location/i, { selector: 'input' }) as HTMLInputElement;
    const body = screen.getByLabelText(/body copy/i, { selector: 'input' }) as HTMLInputElement;

    expect(headline).toBeInTheDocument();
    expect(headline.value).toMatch(/robot riot/i);
    expect(datetime).toBeInTheDocument();
    expect(datetime.value).toMatch(/saturday, july 11/i);
    expect(body).toBeInTheDocument();
    expect(body.value).toMatch(/you build the robot/i);
  });

  it('typing into one region updates that region in the preview and leaves another unchanged', async () => {
    const user = userEvent.setup();
    render(<MockupPostcardEdit />);

    const headlineInput = screen.getByLabelText(/headline/i, { selector: 'input' });
    await user.clear(headlineInput);
    await user.type(headlineInput, 'GO TEAM');

    expect(screen.getByTestId('postcard-region-text-back_headline')).toHaveTextContent('GO TEAM');
    expect(screen.getByTestId('postcard-region-text-back_datetime')).toHaveTextContent(
      /saturday, july 11/i,
    );
  });

  it('switches to the front side on tab click, and back again', async () => {
    const user = userEvent.setup();
    render(<MockupPostcardEdit />);

    expect(screen.getByLabelText(/headline/i, { selector: 'input' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^front$/i }));
    expect(screen.queryByLabelText(/headline/i, { selector: 'input' })).not.toBeInTheDocument();
    expect(screen.getByText(/no text regions on the front side/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.getByLabelText(/headline/i, { selector: 'input' })).toBeInTheDocument();
  });

  it('renders the QR/extra_html placeholder box on the back side, distinguishable from text regions', () => {
    render(<MockupPostcardEdit />);

    const overlay = screen.getByTestId('postcard-extra-overlay');
    expect(overlay).toBeInTheDocument();
    expect(within(overlay).getByText(/qr code overlay/i)).toBeInTheDocument();

    const preview = screen.getByTestId('postcard-preview');
    expect(within(preview).getByTestId('postcard-region-box-back_headline')).toBeInTheDocument();
    expect(overlay).not.toBe(within(preview).getByTestId('postcard-region-box-back_headline'));
  });

  it('clicking a region opens a popup; editing and pressing Return updates the preview', async () => {
    const user = userEvent.setup();
    render(<MockupPostcardEdit />);

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
    // The form field below stays in sync (same underlying state).
    expect((screen.getByLabelText(/^headline$/i) as HTMLInputElement).value).toBe(
      'CLICKED AND EDITED',
    );
  });

  it('Escape closes the popup without applying the draft', async () => {
    const user = userEvent.setup();
    render(<MockupPostcardEdit />);

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
    render(<MockupPostcardEdit />);

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

  it('shows the chat box with the postcard exchange', () => {
    render(<MockupPostcardEdit />);

    expect(screen.getByPlaceholderText(/message claude/i)).toBeInTheDocument();
    expect(screen.getByText(/move the qr code down/i)).toBeInTheDocument();
  });

  it('Generate PDF opens a print window containing both sides and the edited text', async () => {
    const user = userEvent.setup();

    const docWrite = vi.fn();
    const docClose = vi.fn();
    const openMock = vi.fn(() => ({
      document: { write: docWrite, close: docClose },
    }));
    vi.stubGlobal('open', openMock);

    render(<MockupPostcardEdit />);

    const headlineInput = screen.getByLabelText(/headline/i, { selector: 'input' });
    await user.clear(headlineInput);
    await user.type(headlineInput, 'PDF HEADLINE');

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
