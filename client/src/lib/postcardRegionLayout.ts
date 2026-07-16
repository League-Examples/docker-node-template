import type { CSSProperties } from 'react';
import type { PostcardRegionPosition } from '../pages/ProjectDetail/types';

/**
 * Height-aware region/QR layout helpers (OOP change, 2026-07-15) -- the
 * single source of truth both `PostcardFaceEditor.tsx` (the editable text-region
 * editor, 1:1 CSS `in` units on its fixed 6in x 4in canvas) and
 * `OutputPane.tsx`'s `PostcardOverlay` (the read-only iteration-gallery
 * overlay, which renders atop an image that can be displayed at any pixel
 * width up to 800x800) key their box-style and text-layer rendering off of,
 * so a `position.height`-less region always renders the SAME way (grows to
 * fit its text, in normal document flow) everywhere it appears -- matching
 * `server/src/services/postcardRender.ts`'s own `position.height` ->
 * `overflow:hidden` contract (present -> fixed/clipped; absent -> auto-
 * height/flow).
 */

/** Postcard faces are always rendered at a fixed 6in x 4in size. At CSS's
 * fixed absolute-unit conversion, 1in = 96 CSS px, so the editor's own
 * 6in-wide canvas (rendered at 1:1 `in` units) is 576px wide at that
 * reference scale -- `font.size` values in content JSON are px, sized
 * against THAT reference. The gallery overlay renders atop an image
 * displayed at some other pixel width, so both positions (inches) and font
 * sizes (reference-px) need converting to the actual on-screen pixels for
 * whatever width the image ends up rendered at (`scaleFontSize` below). */
export const REFERENCE_WIDTH_PX = 576; // 6in * 96 CSS px/in

function scaleInches(value: string | undefined, pxPerInch: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (pxPerInch === undefined) return value; // editor's own 1:1 canvas usage
  const n = Number.parseFloat(value);
  if (Number.isNaN(n)) return value;
  return `${(n * pxPerInch).toFixed(2)}px`;
}

/** Builds a region/QR's absolute-position CSS. `widthPx` omitted keeps the
 * content JSON's own inch strings as-is (the editor's 1:1 canvas usage);
 * passed, it scales every inch offset to a pixel offset matching an image
 * rendered at that width (`pxPerInch = widthPx / 6`, since a postcard face
 * is always 6in wide) -- the gallery overlay's usage. */
export function regionBoxStyle(position: PostcardRegionPosition, widthPx?: number): CSSProperties {
  const pxPerInch = widthPx === undefined ? undefined : widthPx / 6;
  return {
    top: scaleInches(position.top, pxPerInch),
    left: scaleInches(position.left, pxPerInch),
    right: scaleInches(position.right, pxPerInch),
    width: scaleInches(position.width, pxPerInch),
    height: scaleInches(position.height, pxPerInch),
  };
}

/** Whether a position carries an explicit height (fixed-size, clipped-
 * overflow mode) or not (auto-height, normal-flow mode). */
export function hasExplicitHeight(position: PostcardRegionPosition): boolean {
  return position.height !== undefined;
}

/** Scales a content-JSON `font.size` ("34px", referenced against the
 * editor's fixed `REFERENCE_WIDTH_PX`-wide canvas) to the actual pixel size
 * for a gallery overlay rendered at `widthPx`. Non-numeric sizes pass
 * through unchanged. */
export function scaleFontSize(size: string, widthPx: number): string {
  const n = Number.parseFloat(size);
  if (Number.isNaN(n)) return size;
  return `${(n * (widthPx / REFERENCE_WIDTH_PX)).toFixed(2)}px`;
}

/** Mirrors `server/src/services/postcardRender.ts`'s `textToParagraphsHtml`
 * split logic exactly (OOP change, 2026-07-15) -- the single source of
 * truth `PostcardRegionContent.tsx` (both the editable text editor and the
 * read-only gallery overlay) key their paragraph rendering off of, so a
 * region's text always splits into the SAME paragraphs everywhere it
 * appears, matching the server's PDF/HTML render exactly. Trims ONLY
 * trailing whitespace (`text.replace(/\s+$/, '')` -- leading whitespace is
 * preserved), then splits on one-or-more blank lines, dropping any empty
 * paragraph the split produces (so a trailing `\n\n` doesn't yield a
 * trailing empty paragraph). */
export function splitTextParagraphs(text: string): string[] {
  const trimmed = text.replace(/\s+$/, '');
  return trimmed.split(/\n\n+/).filter((paragraph) => paragraph.length > 0);
}
