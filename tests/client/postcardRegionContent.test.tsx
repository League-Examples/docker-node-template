import { describe, it, expect } from 'vitest';
import { splitTextParagraphs } from '../../client/src/lib/postcardRegionLayout';
import { parseInlineStyle } from '../../client/src/lib/PostcardRegionContent';

/**
 * Unit coverage for the pure helpers behind `PostcardRegionContent.tsx`
 * (OOP change, 2026-07-15) -- `splitTextParagraphs` mirrors
 * `server/src/services/postcardRender.ts`'s `textToParagraphsHtml` split
 * logic exactly, and `parseInlineStyle` turns a region's raw CSS `style`
 * string into a React inline-style object. Neither imports server code --
 * these assertions target the identical paragraph split / style shape the
 * server's own JSDoc worked examples describe.
 */

describe('splitTextParagraphs', () => {
  it('trims trailing blank lines without producing a trailing empty paragraph', () => {
    // Matches postcardRender.ts's own back_headline worked example.
    expect(splitTextParagraphs('ROBOT RIOT\n\n')).toEqual(['ROBOT RIOT']);
  });

  it('keeps a single newline WITHIN a paragraph, splitting only on blank lines', () => {
    // Matches postcardRender.ts's own back_nonprofit worked example: a
    // two-line text with no blank line between the lines is ONE paragraph.
    const text = 'The League of Amazing Programmers is a 501(c)(3) nonprofit\nEIN 20-4744610';
    expect(splitTextParagraphs(text)).toEqual([text]);
  });

  it('splits on one-or-more blank lines into multiple paragraphs', () => {
    expect(splitTextParagraphs('Line one\nLine two\n\nSecond paragraph')).toEqual([
      'Line one\nLine two',
      'Second paragraph',
    ]);
  });

  it('does not trim leading whitespace, only trailing', () => {
    expect(splitTextParagraphs('  leading spaces\n\n')).toEqual(['  leading spaces']);
  });

  it('drops empty paragraphs produced by runs of 3+ newlines', () => {
    expect(splitTextParagraphs('First\n\n\n\nSecond')).toEqual(['First', 'Second']);
  });

  it('returns an empty array for empty or all-whitespace text', () => {
    expect(splitTextParagraphs('')).toEqual([]);
    expect(splitTextParagraphs('   \n\n  ')).toEqual([]);
  });
});

describe('parseInlineStyle', () => {
  it('parses the module header ground-truth example (postcardRender.ts back_headline)', () => {
    expect(parseInlineStyle('font-weight:900; color:#CC1616;')).toEqual({
      fontWeight: '900',
      color: '#CC1616',
    });
  });

  it('parses a real project-11 style string with three declarations', () => {
    expect(parseInlineStyle('font-weight:900; color:#CC1616; letter-spacing:1px;')).toEqual({
      fontWeight: '900',
      color: '#CC1616',
      letterSpacing: '1px',
    });
  });

  it('converts multi-word kebab-case properties to camelCase', () => {
    expect(parseInlineStyle('text-align:center; line-height:1.35;')).toEqual({
      textAlign: 'center',
      lineHeight: '1.35',
    });
  });

  it('skips empty/malformed declarations and tolerates missing trailing semicolon', () => {
    expect(parseInlineStyle('color:#333;;  ; font-weight:700')).toEqual({
      color: '#333',
      fontWeight: '700',
    });
  });

  it('returns an empty object for an empty style string', () => {
    expect(parseInlineStyle('')).toEqual({});
  });
});
