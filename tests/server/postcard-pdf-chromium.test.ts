/**
 * Real-Chromium integration test for `server/src/services/postcardPdf.ts`'s
 * default `rasterizeWithChromium` (ticket 006's spike checkpoint).
 *
 * Skipped by default -- `npm test` must pass without a real `chromium`
 * binary present (this ticket's AC), so every other postcard-PDF test file
 * injects a fake `rasterize`. This file is the documented way to
 * re-verify the spike (Open Question 1 / architecture-update.md R1) if the
 * Alpine/Chromium combination, or a local dev-machine Chrome, ever needs
 * re-confirming: it launches a real browser and does actual pixel sampling
 * on the screenshot, proving the "text regions and QR overlay are visually
 * present" acceptance criterion against the real rasterization path, not
 * just the injected-mock path `postcard-pdf.test.ts` covers.
 *
 * Run manually with a real Chromium/Chrome binary available:
 *
 *   # Alpine container (matches production; this is what the ticket 006
 *   # spike itself ran):
 *   POSTCARD_PDF_CHROMIUM_TEST=1 PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
 *     npx vitest run tests/server/postcard-pdf-chromium.test.ts
 *
 *   # macOS dev machine (no system chromium package; point at Chrome.app):
 *   POSTCARD_PDF_CHROMIUM_TEST=1 \
 *     PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     npx vitest run tests/server/postcard-pdf-chromium.test.ts
 */
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  rasterizeWithChromium,
  TRIM_WIDTH_PX,
  TRIM_HEIGHT_PX,
} from '../../server/src/services/postcardPdf';

const RUN = process.env.POSTCARD_PDF_CHROMIUM_TEST === '1';

describe.skipIf(!RUN)('rasterizeWithChromium (real browser, env-guarded)', () => {
  it('rasters a face HTML doc to a TRIM_WIDTH_PX x TRIM_HEIGHT_PX PNG with the region/QR colors visible', async () => {
    const html = `<!DOCTYPE html>
<html><head><style>
  *{box-sizing:border-box;margin:0;}
  .page{width:6in;height:4in;position:relative;overflow:hidden;background:#ffffff;}
  .region{position:absolute;top:0.5in;left:0.5in;width:2in;height:1in;background:#ff0000;}
  .qr{position:absolute;top:0.5in;right:0.5in;width:1in;height:1in;background:#0000ff;}
</style></head>
<body><section class="page" data-side="front">
  <div class="region" data-region="headline"></div>
  <div class="qr" data-region="qr"></div>
</section></body></html>`;

    const png = await rasterizeWithChromium(html);
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });

    expect(info.width).toBe(TRIM_WIDTH_PX);
    expect(info.height).toBe(TRIM_HEIGHT_PX);

    function pixelAt(xIn: number, yIn: number): [number, number, number] {
      const x = Math.round(xIn * (TRIM_WIDTH_PX / 6));
      const y = Math.round(yIn * (TRIM_HEIGHT_PX / 4));
      const idx = (y * info.width + x) * info.channels;
      return [data[idx], data[idx + 1], data[idx + 2]];
    }

    // Inside the red "region" block (top:0.5in, left:0.5in, 2x1in).
    expect(pixelAt(1.0, 0.8)).toEqual([255, 0, 0]);
    // Inside the blue "qr" block (top:0.5in, right:0.5in, 1x1in -> left
    // edge at 6 - 0.5 - 1 = 4.5in).
    expect(pixelAt(5.0, 0.8)).toEqual([0, 0, 255]);
    // Plain white background elsewhere.
    expect(pixelAt(3.0, 3.5)).toEqual([255, 255, 255]);
  });
});
