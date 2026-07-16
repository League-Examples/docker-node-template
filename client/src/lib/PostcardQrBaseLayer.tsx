import type { PostcardRegionPosition } from '../pages/ProjectDetail/types';
import { regionBoxStyle } from './postcardRegionLayout';
import { displayQrUrl, CAPTION_VIEWBOX_WIDTH, CAPTION_VIEWBOX_HEIGHT, type QrGraphic } from './qrCode';

/**
 * Shared "final-product" base-layer renderer for the postcard QR overlay
 * (OOP change, 2026-07-15) -- the SAME two-layer split
 * `PostcardRegionBaseLayer.tsx` applies to text regions, applied to the QR
 * code: this component is the SINGLE implementation both
 * `ProjectDetail/PostcardOverlay.tsx` (the read-only gallery overlay) and
 * `PostcardFaceEditor.tsx` (the editable editor's chrome-free base QR render)
 * render the QR graphic + URL caption through, so the two can never
 * independently drift.
 *
 * Deliberately NO editing chrome: no move/resize handles, no click
 * handler, no "click to set a QR URL" placeholder (that's an editing-only
 * affordance -- `PostcardFaceEditor.tsx`'s own separate chrome
 * `<button data-testid="postcard-qr-box">` renders it, on top of this
 * layer, only when `!qrGraphic`). Renders nothing (not even an empty
 * placeholder box) inside its positioned wrapper when `qrGraphic` is
 * `null` -- matching the gallery's own contract exactly.
 *
 * `pointer-events-none` is baked onto the wrapper so this layer can never
 * intercept a click/drag meant for whatever sits on top of it -- harmless
 * for the gallery (already wrapped in `pointer-events-none`), load-bearing
 * for the editor's chrome `<button>` sibling.
 */

export interface PostcardQrBaseLayerProps {
  position: PostcardRegionPosition;
  /** Pre-computed QR module grid (`../lib/qrCode.ts`'s `buildQrGraphic`),
   * or `null` when there's nothing to encode yet (no QR, or an empty URL)
   * -- the caller computes this once per render, not this component. */
  qrGraphic: QrGraphic | null;
  /** The QR's raw (already-normalized) URL, for the caption's display text
   * (`displayQrUrl` strips the scheme for display; the QR itself always
   * encodes the full, normalized URL via `qrGraphic`). */
  url: string;
  /** Displayed pixel width of the image this layer sits on top of --
   * omitted for the editor's 1:1 `in`-unit canvas, passed for the
   * gallery's scaled usage (same convention as `PostcardRegionBaseLayer`). */
  widthPx?: number;
  /** `data-testid` for the positioned wrapper div. */
  boxTestId?: string;
  graphicTestId: string;
  urlTestId: string;
}

export default function PostcardQrBaseLayer({
  position,
  qrGraphic,
  url,
  widthPx,
  boxTestId,
  graphicTestId,
  urlTestId,
}: PostcardQrBaseLayerProps) {
  return (
    <div data-testid={boxTestId} className="pointer-events-none absolute" style={regionBoxStyle(position, widthPx)}>
      {qrGraphic && (
        /* Real, scannable QR code (fills the box's WIDTH, not its height --
           `aspect-ratio:1/1` keeps it square regardless of how tall the box
           is) plus the width-matched URL caption directly beneath it. */
        <div className="flex w-full flex-col gap-1">
          <div data-testid={graphicTestId} className="w-full" style={{ aspectRatio: '1 / 1' }}>
            <svg
              viewBox={`0 0 ${qrGraphic.size} ${qrGraphic.size}`}
              width="100%"
              height="100%"
              preserveAspectRatio="none"
              shapeRendering="crispEdges"
            >
              {/* No background rect -- the QR renders on a transparent
                  background so the postcard shows through (stakeholder). */}
              <path d={qrGraphic.path} fill="#000" />
            </svg>
          </div>
          <div
            data-testid={urlTestId}
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
                {displayQrUrl(url)}
              </text>
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}
