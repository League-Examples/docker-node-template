import { create } from 'qrcode';

/**
 * Real, scannable QR code rendering (OOP change, 2026-07-15) for the
 * postcard editor's QR overlay (`pages/PostcardEdit.tsx`) -- mirrors
 * `server/src/services/qrCode.ts`'s SAME approach (an SVG `<path>` built
 * from `qrcode`'s synchronous, canvas-free `create()`) so the editor
 * preview and the server-rendered PDF show the identical graphic for a
 * given URL, not two different QR renderers that could drift apart. There
 * is no shared package between `client/` and `server/` (two independent
 * npm workspaces), so this logic is necessarily duplicated rather than
 * imported -- kept intentionally small, and pinned to the same `qrcode`
 * package/API (`create`) on both sides.
 */

export interface QrGraphic {
  size: number;
  path: string;
}

/** Quiet-zone width in QR modules -- the ISO/IEC 18004 recommended
 * minimum margin of empty space a scanner needs around a QR's data
 * modules to reliably detect the symbol. Without it, a QR sitting on a
 * postcard's photo/color background (not guaranteed white) may simply
 * fail to scan even though the encoded data is correct -- matches
 * `server/src/services/qrCode.ts`'s constant of the same name exactly. */
const QUIET_ZONE_MODULES = 4;

/** Builds the dark-module path data for a QR code encoding `text`, plus
 * the full grid size (data modules + quiet zone on all four sides) it's
 * drawn against (`viewBox="0 0 size size"`). Pure and synchronous --
 * `qrcode`'s `create()` never touches a canvas, so this is safe to call
 * directly from a render function. */
export function buildQrGraphic(text: string): QrGraphic {
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

/** Caption SVG's fixed `viewBox` dimensions -- matches
 * `server/src/services/qrCode.ts`'s constants of the same name exactly.
 * The `<text>` element's `textLength` is always set to
 * `CAPTION_VIEWBOX_WIDTH`, so once the SVG itself is stretched to
 * `width:100%` of the same wrapper the QR graphic above is `width:100%`
 * of, the rendered caption text always spans exactly the QR's width,
 * regardless of the URL's character count -- true for both a short and a
 * very long URL. */
export const CAPTION_VIEWBOX_WIDTH = 400;
export const CAPTION_VIEWBOX_HEIGHT = 44;

/** Prepend `https://` when the user typed a bare host with no scheme, so the
 * QR always encodes a navigable absolute URL. An existing `http://` or
 * `https://` (any case) is left untouched; empty input stays empty. Mirrors
 * `server/src/services/qrCode.ts`'s helper of the same name. */
export function normalizeQrUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '') return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** Strip the scheme for DISPLAY -- the caption beneath the QR shows the bare
 * URL (no `http://`/`https://`) even though the QR itself encodes the full
 * one. Mirrors `server/src/services/qrCode.ts`'s helper of the same name. */
export function displayQrUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '');
}
