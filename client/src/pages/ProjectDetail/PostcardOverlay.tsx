import type { PostcardContentRegionDTO, PostcardQr } from './types';
import { buildQrGraphic, normalizeQrUrl, displayQrUrl, CAPTION_VIEWBOX_WIDTH, CAPTION_VIEWBOX_HEIGHT } from '../../lib/qrCode';
import { regionBoxStyle, hasExplicitHeight } from '../../lib/postcardRegionLayout';
import PostcardRegionContent from '../../lib/PostcardRegionContent';

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
 * Reuses `../../lib/postcardRegionLayout.ts`'s `regionBoxStyle`/
 * `hasExplicitHeight` -- the SAME height-aware rule `PostcardEdit.tsx`'s
 * editor uses (a `position.height`-less region auto-heights to fit its
 * text, in normal document flow; one WITH an explicit height is clipped to
 * it) -- so the gallery preview always matches the editor and the server
 * PDF render, never a third, independently-drifting rendering.
 *
 * **WYSIWYG text rendering (OOP change, 2026-07-15)**: each region's text
 * now renders through `../../lib/PostcardRegionContent.tsx`, the SAME
 * component `PostcardEdit.tsx`'s editor uses -- real `font.family`/
 * `font.size` (scaled by `widthPx`), the region's raw `style` string
 * (e.g. `font-weight:900; color:#CC1616;`), and real paragraph structure
 * (one `<p>` per blank-line-separated paragraph, single newlines within a
 * paragraph becoming `<br />`) -- rather than a plain `whitespace-pre-wrap`
 * text node. This is what makes the gallery preview match the server's
 * canonical PDF/HTML render (`postcardRender.ts`'s `regionStyleAttr` +
 * `textToParagraphsHtml`) instead of just approximating it.
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
      {regions.map((region) => {
        const explicitHeight = hasExplicitHeight(region.position);
        return (
          <div
            key={region.name}
            data-testid={`overlay-region-${region.name}`}
            className={explicitHeight ? 'absolute overflow-hidden' : 'absolute'}
            style={regionBoxStyle(region.position, widthPx)}
          >
            {/* WYSIWYG (OOP change, 2026-07-15): real font/style + paragraph
                structure, via the shared `PostcardRegionContent` also used
                by the editor -- `widthPx` scales font.size to this image's
                displayed pixel width, matching `regionBoxStyle`'s own
                position scaling above. */}
            <PostcardRegionContent
              data-testid={`overlay-region-text-${region.name}`}
              className="block whitespace-pre-wrap"
              text={region.text}
              font={region.font}
              style={region.style}
              widthPx={widthPx}
            />
          </div>
        );
      })}

      {qr && (
        <div data-testid="overlay-qr" className="absolute" style={regionBoxStyle(qr.position, widthPx)}>
          {qrGraphic && (
            <div className="flex w-full flex-col gap-1">
              <div data-testid="overlay-qr-graphic" className="w-full" style={{ aspectRatio: '1 / 1' }}>
                <svg
                  viewBox={`0 0 ${qrGraphic.size} ${qrGraphic.size}`}
                  width="100%"
                  height="100%"
                  preserveAspectRatio="none"
                  shapeRendering="crispEdges"
                >
                  <rect width={qrGraphic.size} height={qrGraphic.size} fill="#fff" />
                  <path d={qrGraphic.path} fill="#000" />
                </svg>
              </div>
              <div
                data-testid="overlay-qr-url"
                className="w-full"
                style={{ aspectRatio: `${CAPTION_VIEWBOX_WIDTH} / ${CAPTION_VIEWBOX_HEIGHT}` }}
              >
                <svg viewBox={`0 0 ${CAPTION_VIEWBOX_WIDTH} ${CAPTION_VIEWBOX_HEIGHT}`} width="100%" height="100%" preserveAspectRatio="none">
                  <text
                    x={0}
                    y={CAPTION_VIEWBOX_HEIGHT - 10}
                    fontFamily="Arial, sans-serif"
                    fontSize={CAPTION_VIEWBOX_HEIGHT - 12}
                    textLength={CAPTION_VIEWBOX_WIDTH}
                    lengthAdjust="spacingAndGlyphs"
                    fill="#333"
                  >
                    {displayQrUrl(qr.url)}
                  </text>
                </svg>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
