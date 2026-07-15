import type { PostcardContentRegionDTO, PostcardQr } from './types';
import { buildQrGraphic, normalizeQrUrl } from '../../lib/qrCode';
import PostcardRegionBaseLayer from '../../lib/PostcardRegionBaseLayer';
import PostcardQrBaseLayer from '../../lib/PostcardQrBaseLayer';

/**
 * Read-only postcard text/QR overlay for the iteration gallery
 * (`OutputPane.tsx`, OOP change 2026-07-15) -- shows the RENDERED postcard
 * (image + text) for whichever iteration currently holds `role: 'front'`/
 * `'back'`, rather than the bare image alone. Sourced from
 * `GET /api/postcards/:projectId`'s saved content JSON
 * (`OutputPane.tsx`'s own fetch), scaled to whatever pixel size the
 * gallery ends up rendering that iteration's image at (`widthPx` --
 * `OutputPane.tsx` measures the actual `<img>` element, since the gallery
 * caps images at 800x800 while preserving aspect ratio, so the on-screen
 * size varies by artwork).
 *
 * Deliberately NO editing affordances: no move-grip label tags, no
 * resize handles, no click-to-edit popup, no `<button>` elements at all --
 * this is a purely visual preview of what will print, not a second editor.
 * `pointer-events-none` on the wrapper ensures the overlay never blocks the
 * gallery's own controls (accepted checkbox, side pulldown, etc).
 *
 * **Two-layer WYSIWYG split (OOP change, 2026-07-15)**: each region's box +
 * text now renders through `../../lib/PostcardRegionBaseLayer.tsx`, the
 * SINGLE shared base-layer component `PostcardEdit.tsx`'s editor also
 * renders (for its own chrome-free base text layer, underneath a
 * completely separate chrome `<button>` sibling carrying the dashed
 * border/label/resize-handle) -- this is what makes the gallery preview
 * and the editor's base rendering provably identical (same component, same
 * props), not just visually similar hand-mirrored JSX, per the
 * stakeholder's explicit "must not drift" requirement. That base-layer
 * component itself uses `../../lib/postcardRegionLayout.ts`'s
 * `regionBoxStyle`/`hasExplicitHeight` (the height-aware auto-flow-vs-
 * clipped rule) and `../../lib/PostcardRegionContent.tsx` (real
 * `font.family`/`font.size` scaled by `widthPx`, the region's raw `style`
 * string, and real paragraph structure mirroring
 * `postcardRender.ts`'s `regionStyleAttr` + `textToParagraphsHtml`) --
 * see that component's own header for the full contract.
 *
 * The QR graphic/caption render through the analogous
 * `../../lib/PostcardQrBaseLayer.tsx`, the same shared component
 * `PostcardEdit.tsx` uses for its own chrome-free base QR render.
 */

interface PostcardOverlayProps {
  regions: PostcardContentRegionDTO[];
  qr?: PostcardQr | null;
  /** Displayed pixel width of the image this overlay sits on top of -- the
   * postcard face is always 6in wide, so `widthPx / 6` is the px-per-inch
   * conversion factor for every region/QR position. `0` (no measurement
   * yet, e.g. before the image has loaded) renders nothing rather than a
   * mispositioned overlay. */
  widthPx: number;
}

export default function PostcardOverlay({ regions, qr, widthPx }: PostcardOverlayProps) {
  if (!widthPx) return null;

  const qrGraphic = qr && qr.url.trim() ? buildQrGraphic(normalizeQrUrl(qr.url)) : null;

  return (
    <div data-testid="postcard-overlay" aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {regions.map((region) => (
        // WYSIWYG two-layer split (OOP change, 2026-07-15): the box + text
        // rendering itself now lives in `../../lib/PostcardRegionBaseLayer.tsx`,
        // the SAME component `PostcardEdit.tsx`'s editor renders for its own
        // (chrome-free) base text layer -- this is what guarantees the
        // gallery preview can never drift from the editor's WYSIWYG base
        // render again.
        <PostcardRegionBaseLayer
          key={region.name}
          boxTestId={`overlay-region-${region.name}`}
          textTestId={`overlay-region-text-${region.name}`}
          position={region.position}
          text={region.text}
          font={region.font}
          style={region.style}
          widthPx={widthPx}
        />
      ))}

      {qr && (
        <PostcardQrBaseLayer
          boxTestId="overlay-qr"
          graphicTestId="overlay-qr-graphic"
          urlTestId="overlay-qr-url"
          position={qr.position}
          qrGraphic={qrGraphic}
          url={qr.url}
          widthPx={widthPx}
        />
      )}
    </div>
  );
}
