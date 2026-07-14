import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MockupPostcardEdit from '../../client/src/pages/mockups/MockupPostcardEdit';

describe('MockupPostcardEdit', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders at least 3 labeled region inputs pre-filled with stub text', () => {
    render(<MockupPostcardEdit />);

    const headline = screen.getByLabelText(/headline/i) as HTMLInputElement;
    const datetime = screen.getByLabelText(/date & location/i) as HTMLInputElement;
    const body = screen.getByLabelText(/body copy/i) as HTMLInputElement;

    expect(headline).toBeInTheDocument();
    expect(headline.value).toMatch(/robot riot/i);
    expect(datetime).toBeInTheDocument();
    expect(datetime.value).toMatch(/saturday, july 11/i);
    expect(body).toBeInTheDocument();
    expect(body.value).toMatch(/you build the robot/i);
  });

  it('shows both front and back previews at once (no toggle)', () => {
    render(<MockupPostcardEdit />);

    expect(screen.getByTestId('postcard-preview-front')).toBeInTheDocument();
    expect(screen.getByTestId('postcard-preview-back')).toBeInTheDocument();
    // The front is image-only in the stub data.
    expect(screen.getByText(/front image only/i)).toBeInTheDocument();
    // No side toggle remains.
    expect(screen.queryByRole('button', { name: /^front$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^back$/i })).not.toBeInTheDocument();
  });

  it('typing into one region updates that region in the preview and leaves another unchanged', async () => {
    const user = userEvent.setup();
    render(<MockupPostcardEdit />);

    const headlineInput = screen.getByLabelText(/headline/i);
    await user.clear(headlineInput);
    await user.type(headlineInput, 'GO TEAM');

    expect(screen.getByTestId('postcard-region-text-back_headline')).toHaveTextContent('GO TEAM');
    expect(screen.getByTestId('postcard-region-text-back_datetime')).toHaveTextContent(
      /saturday, july 11/i,
    );
  });

  it('renders the QR/extra_html placeholder box on the back side, distinguishable from text regions', () => {
    render(<MockupPostcardEdit />);

    const overlay = screen.getByTestId('postcard-extra-overlay');
    expect(overlay).toBeInTheDocument();
    expect(within(overlay).getByText(/qr code overlay/i)).toBeInTheDocument();

    const back = screen.getByTestId('postcard-preview-back');
    expect(within(back).getByTestId('postcard-region-box-back_headline')).toBeInTheDocument();
    expect(overlay).not.toBe(within(back).getByTestId('postcard-region-box-back_headline'));
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

    const headlineInput = screen.getByLabelText(/headline/i);
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
