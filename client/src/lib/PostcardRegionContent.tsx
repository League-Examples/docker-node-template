import { Fragment } from 'react';
import type { CSSProperties } from 'react';
import type { PostcardRegionFont } from '../pages/ProjectDetail/types';
import { scaleFontSize, splitTextParagraphs } from './postcardRegionLayout';

/**
 * Shared WYSIWYG text-region renderer (OOP change, 2026-07-15) -- the SINGLE
 * implementation both `PostcardEdit.tsx` (the editable text-region editor,
 * 1:1 CSS `in`/reference-px units) and `ProjectDetail/PostcardOverlay.tsx`
 * (the read-only gallery overlay, scaled to whatever pixel width its image
 * ends up displayed at) render a region's TEXT through, so the two can never
 * independently drift from each other or from the server's canonical render
 * (`server/src/services/postcardRender.ts`'s `regionStyleAttr` +
 * `textToParagraphsHtml`, which this component mirrors exactly):
 *
 *  - Font: `font-family:<font.family>` + `font-size:<font.size>` (scaled by
 *    `widthPx` via `scaleFontSize` when the caller passes one -- omitted,
 *    the editor's own 1:1-canvas convention, `postcardRegionLayout.ts`'s
 *    `regionBoxStyle`).
 *  - Raw style: the region's own `style` string (e.g.
 *    `"font-weight:900; color:#CC1616;"`), parsed into a React style object
 *    (`parseInlineStyle`) and merged in AFTER font-family/font-size -- same
 *    precedence the server's `regionStyleAttr` uses, so an explicit
 *    `font-size` in a region's raw `style` (if any) would still win, exactly
 *    as it does server-side.
 *  - Paragraphs: `text` split into one `<p>` per blank-line-separated
 *    paragraph (`splitTextParagraphs`, mirroring the server's
 *    `textToParagraphsHtml` split logic exactly), single newlines WITHIN a
 *    paragraph becoming `<br />`. Paragraph spacing is applied via inline
 *    style on each `<p>` (`marginBottom: '0.6em'`, `0` on the last) rather
 *    than new global CSS, replicating the server's `.region p{margin:0 0
 *    0.6em} .region p:last-child{margin-bottom:0}` rule scoped to just this
 *    component's own output.
 *
 * Renders as a single tagged element (no extra DOM wrapper) so both call
 * sites can keep their existing `data-testid`/`className` at the exact same
 * DOM position they held before this component existed -- `PostcardEdit.tsx`
 * keeps its dashed boundary box, move-grip label, resize handle, and
 * click-to-edit entirely outside this component; only the innermost text
 * rendering routes through it.
 */

export interface PostcardRegionContentProps {
  text: string;
  font: PostcardRegionFont;
  /** Raw CSS declarations, verbatim from the region's content-JSON `style`
   * field (`postcardRender.ts`'s `PostcardRegionSchema`) -- parsed and
   * merged into this component's own inline style. */
  style: string;
  /** Displayed pixel width of the image this region sits on top of, for the
   * gallery overlay's scaled usage (`scaleFontSize`). Omitted -- the
   * editor's own 1:1 `in`-unit canvas -- leaves `font.size` unscaled. */
  widthPx?: number;
  className?: string;
  'data-testid'?: string;
  /** Set `true` for an invisible sizing-clone usage (`PostcardEdit.tsx`'s
   * auto-height chrome-sizing clone) so assistive tech skips the
   * duplicate, non-visible text node. */
  'aria-hidden'?: boolean;
}

/** Parses a raw `"k:v; k:v;"` CSS declaration string (a region's `style`
 * field) into a React inline-style object: splits on `;`, splits each
 * declaration on its FIRST `:` (so a value containing `:`, e.g. a URL,
 * survives), trims both sides, skips empty/malformed declarations, and
 * converts kebab-case property names to camelCase (`font-weight` ->
 * `fontWeight`) for React's `style` prop. */
export function parseInlineStyle(style: string): CSSProperties {
  const result: Record<string, string> = {};
  for (const declaration of style.split(';')) {
    const colonIndex = declaration.indexOf(':');
    if (colonIndex === -1) continue;
    const property = declaration.slice(0, colonIndex).trim();
    const value = declaration.slice(colonIndex + 1).trim();
    if (!property || !value) continue;
    const camelProperty = property.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
    result[camelProperty] = value;
  }
  return result as CSSProperties;
}

export default function PostcardRegionContent({
  text,
  font,
  style,
  widthPx,
  className,
  'data-testid': dataTestId,
  'aria-hidden': ariaHidden,
}: PostcardRegionContentProps) {
  const fontSize = widthPx === undefined ? font.size : scaleFontSize(font.size, widthPx);
  const containerStyle: CSSProperties = {
    fontFamily: font.family,
    fontSize,
    ...parseInlineStyle(style),
  };
  const paragraphs = splitTextParagraphs(text);

  return (
    <span className={className} data-testid={dataTestId} aria-hidden={ariaHidden} style={containerStyle}>
      {paragraphs.map((paragraph, index) => (
        <p key={index} style={{ marginTop: 0, marginBottom: index === paragraphs.length - 1 ? 0 : '0.6em' }}>
          {paragraph.split('\n').map((line, lineIndex, lines) => (
            <Fragment key={lineIndex}>
              {line}
              {lineIndex < lines.length - 1 && <br />}
            </Fragment>
          ))}
        </p>
      ))}
    </span>
  );
}
