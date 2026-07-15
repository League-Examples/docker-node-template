import { create } from 'qrcode';

/**
 * Real, scannable QR code rendering (OOP change, 2026-07-15) -- replaces
 * the placeholder `<div data-qr-url="...">QR code<br/>{url}</div>` markup
 * `postcardRender.ts` used to emit for a face's QR overlay. Builds the QR
 * as an inline SVG `<path>` (via `qrcode`'s low-level, synchronous
 * `create()` -- no canvas, no async I/O, no PNG encoding) plus a second
 * SVG holding the URL caption, sized via `textLength` +
 * `lengthAdjust="spacingAndGlyphs"` so the caption text spans EXACTLY the
 * QR's rendered width for any URL length (short or long). Both SVGs are
 * `width:100%` of the SAME flex-column wrapper, so their rendered pixel
 * widths are always equal -- no JS pixel measurement needed anywhere, and
 * this is why the identical markup renders correctly both in a real
 * browser (`client/src/lib/qrCode.ts`'s sibling implementation, used by
 * `PostcardEdit.tsx`'s editor preview) and in headless Chromium
 * (`postcardPdf.ts`'s rasterizer, via this module's HTML string output).
 *
 * There is no shared package between `client/` and `server/` (two
 * independent npm workspaces, no monorepo linking), so the client keeps
 * its own copy of the module-grid-building logic
 * (`client/src/lib/qrCode.ts`) rather than importing this file --
 * necessarily duplicated, but small and pinned to the same `qrcode`
 * dependency version convention on both sides, and both call the same
 * `qrcode` package API (`create`) so a given URL always produces the same
 * module grid regardless of which side rendered it.
 */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Quiet-zone width in QR modules -- the ISO/IEC 18004 recommended
 * minimum margin of empty space a scanner needs around a QR's data
 * modules to reliably detect the symbol. Without it, a QR sitting on a
 * postcard's photo/color background (not guaranteed white) may simply
 * fail to scan even though the encoded data is correct -- this is what
 * makes the rendered code ACTUALLY scannable, not just visually QR-shaped. */
const QUIET_ZONE_MODULES = 4;

/** Builds the dark-module path data for a QR code encoding `text`, plus
 * the full grid size (data modules + quiet zone on all four sides) it's
 * drawn against (`viewBox="0 0 size size"`). Pure and synchronous --
 * `qrcode`'s `create()` never touches a canvas or the filesystem, so this
 * produces the identical result in Node and in a browser. */
function buildQrPath(text: string): { size: number; path: string } {
  const { modules } = create(text, { errorCorrectionLevel: 'M' });
  const moduleCount = modules.size;
  const size = moduleCount + QUIET_ZONE_MODULES * 2;
  let path = '';
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (modules.get(row, col)) {
        path += `M${col + QUIET_ZONE_MODULES},${row + QUIET_ZONE_MODULES}h1v1h-1z`;
      }
    }
  }
  return { size, path };
}

/** The QR graphic itself: a square SVG (`viewBox` = the module grid,
 * `width`/`height` 100% of its container) with dark modules drawn as one
 * `<path>` -- crisp at any raster resolution (Chromium's 256dpi postcard
 * render included), unlike a rasterized PNG would be at arbitrary sizes. */
function qrGraphicSvg(url: string): string {
  const { size, path } = buildQrPath(url);
  return `<svg viewBox="0 0 ${size} ${size}" width="100%" height="100%" preserveAspectRatio="none" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

/** Caption SVG's fixed `viewBox` dimensions -- the `<text>` element's
 * `textLength` is always set to `CAPTION_VIEWBOX_WIDTH`, so once the SVG
 * itself is stretched to `width:100%` of the same wrapper the QR graphic
 * above is `width:100%` of, the rendered caption text always spans
 * exactly the QR's width, regardless of the URL's character count --
 * matches `client/src/lib/qrCode.ts`'s constants exactly, so editor and
 * PDF agree on proportions even though nothing here is shared code. */
export const CAPTION_VIEWBOX_WIDTH = 400;
export const CAPTION_VIEWBOX_HEIGHT = 44;

/** The width-matched URL caption: an SVG whose `<text>` carries
 * `textLength="${CAPTION_VIEWBOX_WIDTH}"` and
 * `lengthAdjust="spacingAndGlyphs"`, so the rendered glyphs always
 * stretch or compress (never wrap, never overflow) to fill the SVG's full
 * width. */
function qrCaptionSvg(url: string): string {
  const escaped = escapeXml(url);
  return `<svg viewBox="0 0 ${CAPTION_VIEWBOX_WIDTH} ${CAPTION_VIEWBOX_HEIGHT}" width="100%" height="100%" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><text x="0" y="${CAPTION_VIEWBOX_HEIGHT - 10}" font-family="Arial, sans-serif" font-size="${CAPTION_VIEWBOX_HEIGHT - 12}" textLength="${CAPTION_VIEWBOX_WIDTH}" lengthAdjust="spacingAndGlyphs" fill="#333">${escaped}</text></svg>`;
}

/** Full QR-box content: the QR graphic (sized to the box's WIDTH, via CSS
 * `aspect-ratio:1/1` -- independent of the box's height, per the OOP
 * brief's "the QR image + URL caption should size to the box's current
 * width") stacked above the width-matched URL caption. Returns `''` for a
 * blank/whitespace-only URL -- nothing to encode yet; `renderQrOverlay`
 * below still renders the surrounding positioned `<div>` in that case
 * (an empty-but-present QR box is valid content-JSON, matching the
 * editor's "added but no URL typed yet" state), just with no graphic
 * inside it. */
export function renderQrGraphicHtml(url: string): string {
  if (url.trim() === '') return '';
  return (
    `<div style="width:100%; display:flex; flex-direction:column; gap:4px;">` +
    `<div style="width:100%; aspect-ratio:1 / 1;">${qrGraphicSvg(url)}</div>` +
    `<div style="width:100%; aspect-ratio:${CAPTION_VIEWBOX_WIDTH} / ${CAPTION_VIEWBOX_HEIGHT};">${qrCaptionSvg(url)}</div>` +
    `</div>`
  );
}
