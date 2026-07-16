import type { PostcardContentRegionDTO, PostcardRegionFont, PostcardRegionPosition } from '../pages/ProjectDetail/types';

/**
 * Pure helpers for the postcard face text/QR editor (Sprint 005 OOP change,
 * 2026-07-15: extracted from `pages/PostcardEdit.tsx`, which this sprint's
 * inline-editing rebuild deletes -- see `ProjectDetail/PostcardFaceEditor.tsx`'s
 * own module header for the full "why extracted" rationale). Kept
 * side-agnostic and free of React state so both the editor component and
 * `ProjectDetail/usePostcardEditorState.ts`'s data layer can import from one
 * place without a circular dependency between them.
 */

export type PostcardSide = 'front' | 'back';

export interface PostcardRegion {
  name: string;
  label: string;
  /** Raw CSS declarations, appended verbatim to the rendered div's style
   * attribute server-side (`postcardRender.ts`'s `regionStyleAttr`) --
   * empty string for a freshly-drawn box (no extra styling yet). */
  style: string;
  position: PostcardRegionPosition;
  font: PostcardRegionFont;
}

export const DEFAULT_FONT: PostcardRegionFont = { family: 'Arial, sans-serif', size: '14px' };

/** Minimum box size a resize handle can shrink a region or QR overlay to. */
export const MIN_BOX_WIDTH_IN = 0.3;
export const MIN_BOX_HEIGHT_IN = 0.2;

/** Default position for a newly-added text region (Sprint 005 OOP change,
 * 2026-07-15: the "+ Text" button replaces the old rubber-band draw -- see
 * `ProjectDetail/PostcardFaceEditor.tsx`'s module header). An explicit
 * `width` AND `height` so the box is immediately resizable via the
 * bottom-right handle, mirroring `QR_OVERLAY_POSITION` below. */
export const DEFAULT_TEXT_REGION_POSITION: PostcardRegionPosition = {
  top: '1.00in',
  left: '0.50in',
  width: '3.00in',
  height: '1.00in',
};

/** The preview canvas's fixed size (`width: '6in', height: '4in'`) -- named
 * here so the alignment-guide overlay's `right`-anchored left-edge math
 * doesn't repeat the magic number. */
export const CANVAS_WIDTH_IN = 6;

/** Default position for a newly-added QR overlay -- identical starting
 * geometry on both faces until moved. QR presence/url/position are a
 * structured, optional-per-face `front_qr`/`back_qr` content-JSON field
 * (`postcardRender.ts`'s `PostcardQrSchema`) rather than an always-on
 * `*_extra_html` overlay. */
export const QR_OVERLAY_POSITION: PostcardRegionPosition = {
  top: '1.15in',
  right: '0.5in',
  width: '1.5in',
  height: '1.5in',
};

/** Debounce window for autosaving edits. */
export const AUTOSAVE_DEBOUNCE_MS = 700;

/** Converts one CSS length string (`"1.15in"`) to canvas-relative pixels at
 * the given px-per-inch ratio. `undefined`/unparseable input is treated as
 * 0. */
export function inToPx(value: string | undefined, ppi: number): number {
  if (!value) return 0;
  const num = Number.parseFloat(value);
  return Number.isNaN(num) ? 0 : num * ppi;
}

/** The dragged box's four edges in canvas-relative pixels, for the
 * alignment-guide overlay. `heightPx` is passed in rather than derived from
 * `position` here because a height-less (auto-height) text region has no
 * `position.height` to convert -- the caller resolves that case before
 * calling this. Left is derived from `position.left` when present, else
 * from `position.right` (mirrors `regionBoxStyle`'s own left/right branch). */
export function boxEdgesPx(
  position: PostcardRegionPosition,
  ppi: number,
  heightPx: number,
): { top: number; left: number; width: number; height: number } {
  const width = inToPx(position.width, ppi);
  const left =
    position.left !== undefined ? inToPx(position.left, ppi) : CANVAS_WIDTH_IN * ppi - inToPx(position.right, ppi) - width;
  const top = inToPx(position.top, ppi);
  return { top, left, width, height: heightPx };
}

/** Turn a label into a region name unique across both faces (server-side
 * `data-region` identifier, `postcardRender.ts`'s `renderRegion`). */
export function makeRegionName(side: PostcardSide, label: string, taken: Set<string>): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'box';
  let name = `${side}_${slug}`;
  let n = 2;
  while (taken.has(name)) name = `${side}_${slug}_${n++}`;
  return name;
}

/** "top 1.0in · left 0.5in · width 3.4in — Arial 14px" */
export function summarizePositionAndFont(region: PostcardRegion): string {
  const { position, font } = region;
  const parts = [`top ${position.top}`];
  if (position.left) parts.push(`left ${position.left}`);
  if (position.right) parts.push(`right ${position.right}`);
  parts.push(`width ${position.width}`);
  const primaryFamily = font.family.split(',')[0].replace(/['"]/g, '').trim();
  return `${parts.join(' · ')} — ${primaryFamily} ${font.size}`;
}

/** Content-JSON shape a single region maps to (`postcardRender.ts`'s
 * `PostcardRegionSchema`) -- `text` comes from `regionText`, everything
 * else from the region's own geometry/label/style/font. */
export function toContentRegion(region: PostcardRegion, regionText: Record<string, string>): PostcardContentRegionDTO {
  return {
    name: region.name,
    label: region.label,
    style: region.style,
    text: regionText[region.name] ?? '',
    position: region.position,
    font: region.font,
  };
}

/** Creates a new text region at the fixed `DEFAULT_TEXT_REGION_POSITION`,
 * auto-labeled uniquely as "Text N" -- the "+ Text" button's whole
 * region-creation path (Sprint 005 OOP change, 2026-07-15, replacing the
 * old drag-to-draw + name-it-yourself flow). Loops through candidate labels
 * ("Text 1", "Text 2", ...) via `makeRegionName` until one produces the
 * expected unsuffixed slug, so the label a stakeholder sees always matches
 * the generated name (`front_text_2`, not `front_text_1_2`). */
export function createDefaultTextRegion(side: PostcardSide, taken: Set<string>): PostcardRegion {
  let n = 1;
  let name = makeRegionName(side, `Text ${n}`, taken);
  while (name !== `${side}_text_${n}`) {
    n += 1;
    name = makeRegionName(side, `Text ${n}`, taken);
  }
  return {
    name,
    label: `Text ${n}`,
    style: '',
    position: { ...DEFAULT_TEXT_REGION_POSITION },
    font: DEFAULT_FONT,
  };
}
