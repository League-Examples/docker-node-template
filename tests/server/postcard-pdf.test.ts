/**
 * Coverage for `server/src/services/postcardPdf.ts` (ticket 006):
 * `renderPostcardPdf`'s raster -> bleed-pad -> rotate -> assemble
 * pipeline, `/TrimBox`/`/BleedBox` metadata, front-only vs. front+back
 * page composition, and `resolveImageSourcesForRaster`'s workspace-path
 * rewriting.
 *
 * The raster step is always injected via `RenderPostcardPdfOptions.rasterize`
 * here -- no real Chromium binary is touched, per this ticket's AC that
 * `npm test` passes without one. `rasterizeWithChromium` (the real,
 * puppeteer-core-backed default) is exercised separately by
 * `postcard-pdf-chromium.test.ts`, an env-guarded integration test that is
 * skipped by default.
 *
 * "Text regions/QR overlay visually present in the rasterized output"
 * (this ticket's AC) is verified two ways without a real browser: (1) a
 * spy on `rasterize` proves the exact HTML handed to the raster stage
 * contains the region/QR markup `postcardRender.ts` produces -- i.e. what
 * a real browser *would* rasterize; and (2) a direct pixel-sampling test
 * of `padWithBleed` proves the raster's pixels survive the bleed/assembly
 * steps unchanged (edge-replication only touches the new bleed margin, not
 * the original trim-size content).
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import {
  renderPostcardPdf,
  padWithBleed,
  resolveImageSourcesForRaster,
  TRIM_WIDTH_PX,
  TRIM_HEIGHT_PX,
  BLEED_PX,
  BLEED_WIDTH_PX,
  BLEED_HEIGHT_PX,
  type FaceRasterizer,
} from '../../server/src/services/postcardPdf';

async function solidPng(width: number, height: number, rgb: [number, number, number]): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } },
  })
    .png()
    .toBuffer();
}

function fixedRasterizer(png: Buffer): FaceRasterizer {
  return async () => png;
}

const FRONT_HTML =
  '<html><body><section class="page" data-side="front"><div class="region" data-region="headline">Hi</div></section></body></html>';
const BACK_HTML =
  '<html><body><section class="page" data-side="back"><div data-region="qr"><img src="qr.png"></div></section></body></html>';

describe('renderPostcardPdf -- front-only composition', () => {
  it('produces exactly one page at the bleed-inclusive dimensions, rotated, with TrimBox/BleedBox set', async () => {
    const trimPng = await solidPng(TRIM_WIDTH_PX, TRIM_HEIGHT_PX, [10, 20, 30]);
    const pdfBytes = await renderPostcardPdf({ front: FRONT_HTML }, { rasterize: fixedRasterizer(trimPng) });

    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();
    expect(pages).toHaveLength(1);

    const page = pages[0];
    // Fixed reference values (sprint.md Test Strategy): 6.25in x 4.25in
    // bleed-inclusive page, in PDF points (72pt/in) -> 450 x 306.
    expect(page.getWidth()).toBe(450);
    expect(page.getHeight()).toBe(306);
    // TrimBox: 6in x 4in, inset by the 1/8in (9pt) bleed margin on all sides.
    expect(page.getTrimBox()).toEqual({ x: 9, y: 9, width: 432, height: 288 });
    // BleedBox: the full page.
    expect(page.getBleedBox()).toEqual({ x: 0, y: 0, width: 450, height: 306 });
    // Vendor-required 90-degree rotation, unconditional.
    expect(page.getRotation().angle).toBe(90);
  });
});

describe('renderPostcardPdf -- front+back composition', () => {
  it('produces exactly two pages, front-then-back order, each passing the per-page checks', async () => {
    const frontPng = await solidPng(TRIM_WIDTH_PX, TRIM_HEIGHT_PX, [200, 0, 0]);
    const backPng = await solidPng(TRIM_WIDTH_PX, TRIM_HEIGHT_PX, [0, 0, 200]);

    const seen: string[] = [];
    const rasterize: FaceRasterizer = async (html) => {
      seen.push(html);
      return html === FRONT_HTML ? frontPng : backPng;
    };

    const pdfBytes = await renderPostcardPdf({ front: FRONT_HTML, back: BACK_HTML }, { rasterize });

    // Rasterized front before back, in that order.
    expect(seen).toEqual([FRONT_HTML, BACK_HTML]);

    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();
    expect(pages).toHaveLength(2);

    for (const page of pages) {
      expect(page.getWidth()).toBe(450);
      expect(page.getHeight()).toBe(306);
      expect(page.getTrimBox()).toEqual({ x: 9, y: 9, width: 432, height: 288 });
      expect(page.getBleedBox()).toEqual({ x: 0, y: 0, width: 450, height: 306 });
      expect(page.getRotation().angle).toBe(90);
    }
  });

  it('omits the back page entirely when html.back is undefined (front-only, AC1/R3 parity)', async () => {
    const trimPng = await solidPng(TRIM_WIDTH_PX, TRIM_HEIGHT_PX, [50, 50, 50]);
    const rasterize = vi.fn(fixedRasterizer(trimPng));
    const pdfBytes = await renderPostcardPdf({ front: FRONT_HTML }, { rasterize });

    expect(rasterize).toHaveBeenCalledTimes(1);
    expect(rasterize).toHaveBeenCalledWith(FRONT_HTML);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    expect(pdfDoc.getPageCount()).toBe(1);
  });
});

describe('renderPostcardPdf -- text regions / QR overlay reach the raster stage', () => {
  it('hands the rasterizer HTML containing the region markup and QR <img>, not a placeholder', async () => {
    const trimPng = await solidPng(TRIM_WIDTH_PX, TRIM_HEIGHT_PX, [0, 0, 0]);
    const rasterize = vi.fn(fixedRasterizer(trimPng));

    await renderPostcardPdf({ front: FRONT_HTML, back: BACK_HTML }, { rasterize });

    const [frontCallHtml, backCallHtml] = rasterize.mock.calls.map((call) => call[0] as string);
    expect(frontCallHtml).toContain('data-region="headline"');
    expect(backCallHtml).toContain('<img src="qr.png">');
  });
});

describe('padWithBleed -- edge-replicate bleed technique (pixel sampling)', () => {
  it('extends the raster by BLEED_PX on every side, replicating the nearest trim-edge pixel', async () => {
    // Left half red, right half blue -- a spatially distinguishable trim
    // image so the padded corners can be checked against the *nearest*
    // edge pixel, not just "some" edge pixel.
    const half = TRIM_WIDTH_PX / 2;
    const trimPng = await sharp({
      create: { width: TRIM_WIDTH_PX, height: TRIM_HEIGHT_PX, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .composite([{ input: await solidPng(half, TRIM_HEIGHT_PX, [0, 0, 255]), left: half, top: 0 }])
      .png()
      .toBuffer();

    const bleedPng = await padWithBleed(trimPng);
    const { data, info } = await sharp(bleedPng).raw().toBuffer({ resolveWithObject: true });

    expect(info.width).toBe(BLEED_WIDTH_PX);
    expect(info.height).toBe(BLEED_HEIGHT_PX);

    function pixelAt(x: number, y: number): [number, number, number] {
      const idx = (y * info.width + x) * info.channels;
      return [data[idx], data[idx + 1], data[idx + 2]];
    }

    // Top-left bleed corner replicates the trim's top-left pixel (red).
    expect(pixelAt(0, 0)).toEqual([255, 0, 0]);
    // Top-right bleed corner replicates the trim's top-right pixel (blue).
    expect(pixelAt(BLEED_WIDTH_PX - 1, 0)).toEqual([0, 0, 255]);
    // Directly above the red half (outside the trim, in the new top
    // margin) still reads red -- edge replication extends the column
    // outward, it does not blend/smear diagonally.
    expect(pixelAt(BLEED_PX + 10, 0)).toEqual([255, 0, 0]);
    // A pixel well inside the original trim area is untouched.
    expect(pixelAt(BLEED_PX + 10, BLEED_PX + 10)).toEqual([255, 0, 0]);
  });
});

describe('resolveImageSourcesForRaster', () => {
  let testRoot: string;
  let previousWorkspaceDir: string | undefined;

  beforeAll(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'flyerbot-postcard-pdf-test-'));
    previousWorkspaceDir = process.env.WORKSPACE_DIR;
    process.env.WORKSPACE_DIR = testRoot;
  });

  afterAll(async () => {
    if (previousWorkspaceDir === undefined) {
      delete process.env.WORKSPACE_DIR;
    } else {
      process.env.WORKSPACE_DIR = previousWorkspaceDir;
    }
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('rewrites a workspace-relative src to an absolute file:// URL', () => {
    const html = '<img class="bg" src="projects/1/iterations/iter-1.png">';
    const rewritten = resolveImageSourcesForRaster(html);
    expect(rewritten).toBe(`<img class="bg" src="file://${path.join(testRoot, 'projects/1/iterations/iter-1.png')}">`);
  });

  it('leaves already-absolute http(s)/data/file sources unchanged', () => {
    const html =
      '<img src="https://example.com/a.png"><img src="data:image/png;base64,AAAA"><img src="file:///already/abs.png">';
    expect(resolveImageSourcesForRaster(html)).toBe(html);
  });

  it('leaves a workspace-escaping src unchanged rather than throwing', () => {
    const html = '<img src="../../etc/passwd">';
    expect(() => resolveImageSourcesForRaster(html)).not.toThrow();
    expect(resolveImageSourcesForRaster(html)).toBe(html);
  });

  it('rewrites multiple src attributes independently (background image + QR overlay)', () => {
    const html =
      '<img class="bg" src="projects/1/iterations/iter-1.png"><div><img src="projects/1/outputs/qr.png"></div>';
    const rewritten = resolveImageSourcesForRaster(html);
    expect(rewritten).toContain(`file://${path.join(testRoot, 'projects/1/iterations/iter-1.png')}`);
    expect(rewritten).toContain(`file://${path.join(testRoot, 'projects/1/outputs/qr.png')}`);
  });
});
