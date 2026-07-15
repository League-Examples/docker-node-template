import { existsSync, readFileSync } from 'node:fs';
import sharp from 'sharp';
import { PDFDocument, degrees } from 'pdf-lib';
import { resolveWorkspacePath } from './workspaceDirectorySync';

/**
 * Resolve the Chromium/Chrome executable puppeteer-core should launch.
 * `PUPPETEER_EXECUTABLE_PATH` wins when set (the deployment/Docker override).
 * Otherwise probe the common locations across environments -- the Alpine
 * runtime's `apk` chromium first (production), then a macOS dev machine's
 * Google Chrome / Chromium -- so local dev works without any env config.
 * Falls back to the Alpine path so `launch` throws a clear "not found" error
 * rather than an empty string, if nothing is present.
 */
function resolveBrowserExecutablePath(): string {
  const configured = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (configured) return configured;
  const candidates = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      /* ignore and keep probing */
    }
  }
  return candidates[0];
}

/**
 * Postcard Render & PDF Service, second half (architecture-update.md Step
 * 3, addendum eleventh module; ticket 006). Turns the per-face HTML strings
 * `postcardRender.ts`'s `renderPostcardHtml` produces into a print-ready
 * `postcard.pdf`, matching `postcard-4x6.md` and the predecessor's
 * `generate_postcard_pdf` exactly:
 *
 *   raster (headless Chromium, trim size) -> pad (edge-replicate bleed)
 *   -> assemble (pdf-lib, one page per face, `/TrimBox`+`/BleedBox`
 *   metadata, 90-degree vendor rotation)
 *
 * **Resolution convention**: 256dpi, matching `postcard-4x6.md`'s stated
 * "32px at the postcard-4x6 resolution convention" for a 1/8in bleed (32 =
 * 0.125 * 256). Trim size (6in x 4in) is therefore 1536x1024px; the
 * bleed-inclusive raster (6.25in x 4.25in) is 1600x1088px.
 *
 * **Rasterization backend (R1, Open Question 1)**: `puppeteer-core`
 * driving Alpine's `apk`-installed, musl-native `chromium` binary (not
 * Puppeteer's own bundled glibc download -- the `sqlite-vec` lesson).
 * Spiked against a container built from this repo's actual `Dockerfile`
 * (with `apk add chromium` added to the runtime stage): confirmed working
 * -- `puppeteer-core` launches Alpine's `chromium` package and rasters a
 * trivial HTML page successfully (Open Question 1 resolved, no fallback
 * needed). Executable path defaults to `/usr/bin/chromium-browser` (the
 * apk package's launcher symlink), overridable via
 * `PUPPETEER_EXECUTABLE_PATH` for other environments (e.g. a local macOS
 * Chrome/Chromium install during manual spike re-verification).
 *
 * **R1's stated fallback seam**: the rasterization step is injectable
 * (`RenderPostcardPdfOptions.rasterize`) precisely so a different backend
 * can be swapped in behind `renderPostcardPdf`'s interface without a
 * call-site change, if Alpine's `chromium` package ever proves unworkable
 * in a real deployment. Tests use this seam to run the pad/rotate/assemble
 * pipeline deterministically, without needing a real Chromium binary in CI
 * (this ticket's AC "npm test passes without requiring the actual chromium
 * binary").
 *
 * **Crop marks**: NOT drawn. `postcard-4x6.md`'s documented technique
 * positions crop marks *outside* the 6.25x4.25in bleed box, but this
 * pipeline's PDF page (`/MediaBox`) is exactly the bleed-inclusive size --
 * there is no page area outside the bleed box to draw into. Drawing marks
 * *inside* the bleed box (the only area available) would put visible ink
 * inside the printed/trimmed piece, which is worse than no marks at all,
 * not a cheap equivalent. Enlarging `/MediaBox` beyond 6.25x4.25in to make
 * room would depart from this ticket's explicit box-dimension acceptance
 * criteria. Recorded here as a follow-up (matches the predecessor's own
 * documented gap in `postcard-4x6.md`'s Crop Marks section) rather than
 * silently omitted: a future ticket that wants real crop marks needs to
 * widen the page beyond the bleed box first.
 */

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

/** Raster resolution convention, matching postcard-4x6.md's "32px bleed at
 * this resolution" statement (32 = 0.125in * 256dpi). */
export const DPI = 256;
/** Browsers resolve CSS `in` units at a fixed 96px/in regardless of device
 * pixel ratio -- this is the scale factor needed to make a Chromium
 * screenshot come out at `DPI` instead. */
const CSS_DPI = 96;
const DEVICE_SCALE_FACTOR = DPI / CSS_DPI;

const TRIM_WIDTH_IN = 6;
const TRIM_HEIGHT_IN = 4;
const BLEED_IN = 0.125;

/** Trim-size raster dimensions in px (6in x 4in @ 256dpi). */
export const TRIM_WIDTH_PX = TRIM_WIDTH_IN * DPI; // 1536
export const TRIM_HEIGHT_PX = TRIM_HEIGHT_IN * DPI; // 1024
/** One side's bleed padding in px (1/8in @ 256dpi). */
export const BLEED_PX = Math.round(BLEED_IN * DPI); // 32
/** Bleed-inclusive raster dimensions in px (6.25in x 4.25in @ 256dpi). */
export const BLEED_WIDTH_PX = TRIM_WIDTH_PX + 2 * BLEED_PX; // 1600
export const BLEED_HEIGHT_PX = TRIM_HEIGHT_PX + 2 * BLEED_PX; // 1088

const PT_PER_IN = 72;
/** Trim box dimensions in PDF points (6in x 4in). */
export const TRIM_WIDTH_PT = TRIM_WIDTH_IN * PT_PER_IN; // 432
export const TRIM_HEIGHT_PT = TRIM_HEIGHT_IN * PT_PER_IN; // 288
/** Bleed box / page dimensions in PDF points (6.25in x 4.25in). */
export const BLEED_WIDTH_PT = (TRIM_WIDTH_IN + 2 * BLEED_IN) * PT_PER_IN; // 450
export const BLEED_HEIGHT_PT = (TRIM_HEIGHT_IN + 2 * BLEED_IN) * PT_PER_IN; // 306
/** Bleed margin in PDF points -- the TrimBox's inset from the page edge. */
export const BLEED_MARGIN_PT = BLEED_IN * PT_PER_IN; // 9

// ---------------------------------------------------------------------------
// Rasterization
// ---------------------------------------------------------------------------

/** Rasterizes one face's self-contained HTML doc (as produced by
 * `postcardRender.ts`'s `renderPostcardHtml`, called with only one of
 * `front_image`/`back_image` present so exactly one `.page` element
 * exists) to a `TRIM_WIDTH_PX` x `TRIM_HEIGHT_PX` PNG buffer -- no bleed,
 * no rotation, just the trim-size raster. Injectable so
 * `renderPostcardPdf` can be tested without a real browser (R1's fallback
 * seam doubles as the test seam). */
export type FaceRasterizer = (html: string) => Promise<Buffer>;

const RELATIVE_SRC_RE = /src="([^"]+)"/g;

/** Rewrites `<img src="...">` values that are workspace-relative paths
 * (e.g. `projects/5/iterations/iter-1.png`, the shape
 * `postcardRender.ts`'s templates emit) to absolute `file://` URLs, via
 * the same `resolveWorkspacePath` containment used everywhere else in the
 * app. Chromium's `page.setContent` has no base URL, so a relative `src`
 * would otherwise resolve against `about:blank` and never load --
 * production has no route serving workspace files over HTTP yet either
 * (Sprint 005's job), so `file://` is the only way this pipeline can see
 * the actual image bytes today. Already-absolute sources (`http(s):`,
 * `data:`, `file:`) pass through unchanged. A source that fails to
 * resolve (escapes the workspace root) is left as-is rather than thrown --
 * front/back images are already validated by `resolvePostcardImages`
 * upstream of this module; only `extra_html`-supplied sources (e.g. a QR
 * overlay) reach this fallback, and a broken one should degrade to a
 * missing image in the raster, not abort the whole PDF. */
function imageMimeForPath(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    case 'heic':
      return 'image/heic';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Inline each workspace-relative `<img src>` as a base64 `data:` URI before
 * the HTML is fed to Chromium via `page.setContent`. A `file://` src (the
 * previous approach) is BLOCKED by Chromium as a subresource load from the
 * `about:blank`-origin document `setContent` creates -- so the artwork
 * silently failed to load and every PDF face rendered blank white. A `data:`
 * URI carries the bytes in the markup itself and loads regardless of origin.
 * Already-absolute (`http`/`data`/`file`) srcs and unreadable files are left
 * untouched -- a missing file degrades to a blank image, not an aborted PDF.
 */
export function resolveImageSourcesForRaster(html: string): string {
  return html.replace(RELATIVE_SRC_RE, (match, src: string) => {
    if (/^(https?:|data:|file:)/i.test(src)) return match;
    try {
      const absolute = resolveWorkspacePath(src);
      const bytes = readFileSync(absolute);
      return `src="data:${imageMimeForPath(absolute)};base64,${bytes.toString('base64')}"`;
    } catch {
      return match;
    }
  });
}

/** Default `FaceRasterizer`: launches Alpine's `apk`-installed `chromium`
 * binary via `puppeteer-core` (no bundled browser download -- R1), renders
 * the face HTML, and screenshots its `.page` element at `DEVICE_SCALE_FACTOR`
 * so the resulting PNG is exactly `TRIM_WIDTH_PX` x `TRIM_HEIGHT_PX` (the
 * `.page` element's CSS size is a fixed 6in x 4in, per
 * `postcardRender.ts`). */
export const rasterizeWithChromium: FaceRasterizer = async (html) => {
  // Lazy import: keeps `puppeteer-core` off the require graph for callers
  // (tests) that always inject a stub rasterizer and never touch a real
  // browser.
  const { default: puppeteer } = await import('puppeteer-core');
  const executablePath = resolveBrowserExecutablePath();

  const browser = await puppeteer.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: Math.ceil(TRIM_WIDTH_IN * CSS_DPI),
      height: Math.ceil(TRIM_HEIGHT_IN * CSS_DPI),
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
    });
    // `setContent`'s `waitUntil` only supports `'load'`/`'domcontentloaded'`
    // (unlike `goto`'s `'networkidle0'`) -- `'load'` is sufficient here
    // since every image this pipeline embeds is an inline `data:` URI
    // (rewritten by `resolveImageSourcesForRaster` above), which blocks the
    // `load` event exactly like any other resource but needs no network.
    await page.setContent(resolveImageSourcesForRaster(html), { waitUntil: 'load' });
    const pageElement = await page.$('.page');
    if (!pageElement) {
      throw new Error('renderPostcardPdf: rasterized HTML has no .page element to screenshot');
    }
    const shot = await pageElement.screenshot({ type: 'png' });
    return Buffer.from(shot);
  } finally {
    await browser.close();
  }
};

// ---------------------------------------------------------------------------
// Bleed padding
// ---------------------------------------------------------------------------

/** Pads a `TRIM_WIDTH_PX` x `TRIM_HEIGHT_PX` raster by `BLEED_PX` on every
 * side via edge-replication (sharp's `extendWith: 'copy'`) -- the exact
 * technique `postcard-4x6.md` documents for source art with no built-in
 * overscan. Returns a `BLEED_WIDTH_PX` x `BLEED_HEIGHT_PX` PNG buffer. */
export async function padWithBleed(trimPng: Buffer): Promise<Buffer> {
  return sharp(trimPng)
    .extend({
      top: BLEED_PX,
      bottom: BLEED_PX,
      left: BLEED_PX,
      right: BLEED_PX,
      extendWith: 'copy',
    })
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// PDF assembly
// ---------------------------------------------------------------------------

/** Adds one page to `pdfDoc` for a `BLEED_WIDTH_PX` x `BLEED_HEIGHT_PX`
 * bleed-padded face PNG: page size = the bleed-inclusive dimensions
 * (6.25in x 4.25in, in points), `/TrimBox` inset by the bleed margin (6in
 * x 4in, centered), `/BleedBox` = the full page, and a 90-degree rotation
 * (vendor submission requirement, unconditional, matching the
 * predecessor) applied as a `pdf-lib` page-rotation flag -- the underlying
 * image pixels are not re-encoded, only the page's `/Rotate` entry is set,
 * which is what actually rotates the *presentation* per the PDF spec while
 * `/TrimBox`/`/BleedBox` stay expressed in the page's own (unrotated)
 * coordinate system. */
async function addFacePage(pdfDoc: PDFDocument, bleedPng: Buffer): Promise<void> {
  const image = await pdfDoc.embedPng(bleedPng);
  const page = pdfDoc.addPage([BLEED_WIDTH_PT, BLEED_HEIGHT_PT]);
  page.drawImage(image, { x: 0, y: 0, width: BLEED_WIDTH_PT, height: BLEED_HEIGHT_PT });
  page.setTrimBox(BLEED_MARGIN_PT, BLEED_MARGIN_PT, TRIM_WIDTH_PT, TRIM_HEIGHT_PT);
  page.setBleedBox(0, 0, BLEED_WIDTH_PT, BLEED_HEIGHT_PT);
  page.setRotation(degrees(90));
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface RenderPostcardPdfOptions {
  /** Overrides the raster backend -- R1's fallback seam and this module's
   * test seam. Defaults to `rasterizeWithChromium`. */
  rasterize?: FaceRasterizer;
}

/** Renders a postcard's front (and, if present, back) face HTML to a
 * print-ready PDF: raster each present face at trim size, pad by 1/8in via
 * edge-replication, assemble into one page per face (front-then-back
 * order) with `/TrimBox`/`/BleedBox` metadata and a 90-degree rotation.
 * `html.front` and `html.back` are expected to each be a complete,
 * self-contained `postcardRender.ts`-produced HTML doc containing exactly
 * one `.page` element (i.e. rendered from content JSON with only that
 * face's image set) -- this keeps the interface narrow and this module
 * fully decoupled from the content-JSON shape itself. */
export async function renderPostcardPdf(
  html: { front: string; back?: string },
  options: RenderPostcardPdfOptions = {}
): Promise<Buffer> {
  const rasterize = options.rasterize ?? rasterizeWithChromium;

  const faces: Array<{ side: 'front' | 'back'; html: string }> = [{ side: 'front', html: html.front }];
  if (html.back !== undefined) faces.push({ side: 'back', html: html.back });

  const pdfDoc = await PDFDocument.create();
  for (const face of faces) {
    const trimPng = await rasterize(face.html);
    const bleedPng = await padWithBleed(trimPng);
    await addFacePage(pdfDoc, bleedPng);
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
