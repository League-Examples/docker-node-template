import type { PostcardRegionFont, PostcardRegionPosition } from '../pages/ProjectDetail/types';
import { regionBoxStyle, hasExplicitHeight } from './postcardRegionLayout';
import PostcardRegionContent from './PostcardRegionContent';

/**
 * Shared "final-product" base-layer renderer for a single postcard text
 * region (OOP change, 2026-07-15) -- the SINGLE implementation both
 * `ProjectDetail/PostcardOverlay.tsx` (the read-only gallery overlay) and
 * `PostcardEdit.tsx` (the editable text-region editor) render a region's
 * BOX + TEXT through, so the two can never independently drift from each
 * other again. This is exactly the wrapper-div-plus-`PostcardRegionContent`
 * JSX `PostcardOverlay.tsx` already used inline before this component
 * existed -- factored out, not reinvented, per the stakeholder's explicit
 * instruction: "start with the rendering that you use for the final
 * product."
 *
 * Deliberately carries NO editing chrome: no padding, no border, no label,
 * no resize handle, no click handler. `PostcardEdit.tsx` renders this
 * component for a region's visible text, then layers a completely separate
 * sibling `<button>` (unstyled here, entirely in `PostcardEdit.tsx`) on TOP
 * of it, at the same `regionBoxStyle` geometry, to carry the dashed
 * boundary/label/resize-handle/click-to-edit affordances -- see that file's
 * region-rendering block for the chrome layer and its own auto-height
 * sizing-clone comment.
 *
 * `pointer-events-none` is baked onto the wrapper here (not left to each
 * caller) so this component can never intercept a click/drag meant for
 * whatever sits on top of it -- harmless for `PostcardOverlay.tsx`, which
 * already wraps its entire overlay in `pointer-events-none`; load-bearing
 * for `PostcardEdit.tsx`, whose chrome `<button>` sibling needs every
 * pointer event to reach IT, not this plain text div underneath.
 */

export interface PostcardRegionBaseLayerProps {
  position: PostcardRegionPosition;
  /** The region's current text. An explicit prop (not read off a static
   * DTO field) so `PostcardEdit.tsx` can pass its own live, editable
   * `regionText[name]` state, not a snapshot. */
  text: string;
  font: PostcardRegionFont;
  /** Raw CSS declarations, verbatim from the region's content-JSON `style`
   * field -- forwarded to `PostcardRegionContent`. */
  style: string;
  /** Displayed pixel width of the image/canvas this region sits on top of.
   * Omitted -- the editor's own 1:1 `in`-unit canvas convention -- leaves
   * `regionBoxStyle`/`font.size` unscaled; passed -- the gallery's scaled
   * usage -- scales both position and font size to that pixel width. */
  widthPx?: number;
  /** `data-testid` for the positioned wrapper div (the "box"). */
  boxTestId?: string;
  /** `data-testid` for the inner `PostcardRegionContent` (the "text"). */
  textTestId?: string;
}

export default function PostcardRegionBaseLayer({
  position,
  text,
  font,
  style,
  widthPx,
  boxTestId,
  textTestId,
}: PostcardRegionBaseLayerProps) {
  const explicitHeight = hasExplicitHeight(position);
  return (
    <div
      data-testid={boxTestId}
      className={explicitHeight ? 'pointer-events-none absolute overflow-hidden' : 'pointer-events-none absolute'}
      style={regionBoxStyle(position, widthPx)}
    >
      <PostcardRegionContent
        data-testid={textTestId}
        className="block whitespace-pre-wrap"
        text={text}
        font={font}
        style={style}
        widthPx={widthPx}
      />
    </div>
  );
}
