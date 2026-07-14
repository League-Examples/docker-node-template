import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MockupPostcardEdit from '../../client/src/pages/mockups/MockupPostcardEdit';

describe('MockupPostcardEdit', () => {
  it('renders at least 3 labeled region inputs pre-filled with stub text on the default (back) side', () => {
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

  it('switches to the front side region set on toggle, and back again', async () => {
    const user = userEvent.setup();
    render(<MockupPostcardEdit />);

    expect(screen.getByLabelText(/headline/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^front$/i }));
    expect(screen.queryByLabelText(/headline/i)).not.toBeInTheDocument();
    expect(screen.getByText(/no text regions on the front side/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.getByLabelText(/headline/i)).toBeInTheDocument();
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
});
