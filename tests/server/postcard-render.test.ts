/**
 * Unit coverage for `server/src/services/postcardRender.ts` (ticket 005):
 * content-JSON shape validation (`parsePostcardContent`), the
 * `Iteration.imagePath` cross-check (`resolvePostcardImages`), and HTML
 * templating (`renderPostcardHtml`) -- exercised directly, without an HTTP
 * layer or a real database, so paragraph/style-rendering edge cases are
 * cheap to assert precisely. `tests/server/postcard-route.test.ts` covers
 * the same acceptance criteria end-to-end through the HTTP route and real
 * Prisma/filesystem writes.
 */
import { describe, it, expect } from 'vitest';
import {
  parsePostcardContent,
  resolvePostcardImages,
  renderPostcardHtml,
  PostcardValidationError,
  type PostcardContent,
} from '../../server/src/services/postcardRender';

function minimalRegion(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: 'r1',
    label: 'Region 1',
    style: '',
    text: 'hello',
    rows: null,
    position: { top: '1in', left: '1in', width: '2in' },
    font: { family: 'Arial', size: '12px' },
    ...overrides,
  };
}

describe('parsePostcardContent', () => {
  it('accepts a minimal front-only content JSON, defaulting absent arrays/extra_html', () => {
    const content = parsePostcardContent({ front_image: 'projects/1/iterations/iter-1.png' });
    expect(content.front_image).toBe('projects/1/iterations/iter-1.png');
    expect(content.back_image).toBeUndefined();
    expect(content.front_regions).toEqual([]);
    expect(content.back_regions).toEqual([]);
    expect(content.front_extra_html).toBe('');
    expect(content.back_extra_html).toBe('');
  });

  it('rejects a content JSON with neither front_image nor back_image', () => {
    expect(() => parsePostcardContent({ front_regions: [] })).toThrow(PostcardValidationError);
  });

  it('rejects a region position with neither left nor right', () => {
    expect(() =>
      parsePostcardContent({
        front_image: 'x',
        front_regions: [minimalRegion({ position: { top: '1in', width: '2in' } })],
      })
    ).toThrow(PostcardValidationError);
  });

  it('rejects a region missing a required field', () => {
    expect(() =>
      parsePostcardContent({
        front_image: 'x',
        front_regions: [{ name: 'r1' }],
      })
    ).toThrow(PostcardValidationError);
  });

  it('accepts an explicit position.height (wireframe exact-drawn-size contract)', () => {
    const content = parsePostcardContent({
      front_image: 'x',
      front_regions: [minimalRegion({ position: { top: '1in', left: '1in', width: '2in', height: '0.5in' } })],
    });
    expect(content.front_regions[0].position.height).toBe('0.5in');
  });

  it('rejects non-object input', () => {
    expect(() => parsePostcardContent('not an object')).toThrow(PostcardValidationError);
    expect(() => parsePostcardContent(null)).toThrow(PostcardValidationError);
  });
});

describe('resolvePostcardImages', () => {
  function fakePrisma(existingImagePaths: string[]) {
    return {
      iteration: {
        findFirst: async ({ where }: { where: { projectId: number; imagePath: string } }) =>
          existingImagePaths.includes(where.imagePath) ? { id: 1, ...where } : null,
      },
    };
  }

  it('resolves cleanly when both images match existing Iterations', async () => {
    const content = parsePostcardContent({
      front_image: 'a.png',
      back_image: 'b.png',
    });
    await expect(resolvePostcardImages(content, 1, fakePrisma(['a.png', 'b.png']))).resolves.toBeUndefined();
  });

  it('throws PostcardValidationError naming the field when front_image has no matching Iteration', async () => {
    const content = parsePostcardContent({ front_image: 'missing.png' });
    await expect(resolvePostcardImages(content, 1, fakePrisma([]))).rejects.toThrow(PostcardValidationError);
    await expect(resolvePostcardImages(content, 1, fakePrisma([]))).rejects.toThrow(/front_image/);
    await expect(resolvePostcardImages(content, 1, fakePrisma([]))).rejects.toThrow(/missing\.png/);
  });

  it('skips the check for whichever of front_image/back_image is absent', async () => {
    const content = parsePostcardContent({ front_image: 'a.png' });
    await expect(resolvePostcardImages(content, 1, fakePrisma(['a.png']))).resolves.toBeUndefined();
  });
});

describe('renderPostcardHtml', () => {
  it('renders only the front face when back_image is absent (AC1, R3)', () => {
    const content = parsePostcardContent({
      front_image: 'front.png',
      front_regions: [minimalRegion()],
    });
    const html = renderPostcardHtml(content);
    expect(html).toContain('data-side="front"');
    expect(html).not.toContain('data-side="back"');
    expect(html).toContain('front.png');
  });

  it('renders both faces when both images are present (AC2)', () => {
    const content = parsePostcardContent({
      front_image: 'front.png',
      back_image: 'back.png',
    });
    const html = renderPostcardHtml(content);
    expect(html).toContain('data-side="front"');
    expect(html).toContain('data-side="back"');
  });

  it('matches the predecessor postcard.html paragraph rendering exactly for a trailing-blank-line headline', () => {
    // Ground truth: marketing/projects/Robot-Riot-Postcard/postcard-content.json's
    // back_headline is "ROBOT RIOT\n\n", and postcard.html renders it as
    // exactly `<p>ROBOT RIOT</p>` -- no empty trailing paragraph.
    const content = parsePostcardContent({
      front_image: 'front.png',
      front_regions: [minimalRegion({ name: 'headline', text: 'ROBOT RIOT\n\n' })],
    });
    const html = renderPostcardHtml(content);
    expect(html).toContain('<p>ROBOT RIOT</p>');
    expect(html).not.toContain('<p></p>');
  });

  it('matches the predecessor rendering for a two-line paragraph (single newline -> <br />)', () => {
    // Ground truth: back_nonprofit's two-line text renders as one <p> with
    // an internal <br /> between the lines, not two separate <p> tags.
    const content = parsePostcardContent({
      front_image: 'front.png',
      front_regions: [
        minimalRegion({
          name: 'nonprofit',
          text: 'The League of Amazing Programmers is a 501(c)(3) nonprofit\nEIN 20-4744610',
        }),
      ],
    });
    const html = renderPostcardHtml(content);
    expect(html).toContain(
      '<p>The League of Amazing Programmers is a 501(c)(3) nonprofit<br />\nEIN 20-4744610</p>'
    );
  });

  it('renders each region\'s position and font values, and appends the region\'s own style CSS', () => {
    const content = parsePostcardContent({
      front_image: 'front.png',
      front_regions: [
        minimalRegion({
          position: { top: '1.0in', left: '0.5in', width: '3.4in' },
          font: { family: "'Arial Black', Arial, sans-serif", size: '34px' },
          style: 'font-weight:900; color:#CC1616;',
        }),
      ],
    });
    const html = renderPostcardHtml(content);
    expect(html).toContain('top:1.0in');
    expect(html).toContain('left:0.5in');
    expect(html).toContain('width:3.4in');
    // The style attribute is HTML-escaped as a whole (it's an attribute
    // value), so a font-family containing single quotes comes through
    // entity-escaped -- the raw quote form must NOT appear unescaped.
    expect(html).toContain('font-family:&#39;Arial Black&#39;, Arial, sans-serif');
    expect(html).not.toContain("font-family:'Arial Black'");
    expect(html).toContain('font-size:34px');
    expect(html).toContain('font-weight:900');
    expect(html).toContain('color:#CC1616');
  });

  it('adds overflow:hidden when position.height is present (wireframe clipped-overflow contract)', () => {
    const content = parsePostcardContent({
      front_image: 'front.png',
      front_regions: [minimalRegion({ position: { top: '1in', left: '1in', width: '2in', height: '1in' } })],
    });
    const html = renderPostcardHtml(content);
    expect(html).toContain('height:1in');
    expect(html).toContain('overflow:hidden');
  });

  it('does not add overflow:hidden to the region itself when position.height is absent', () => {
    // Note: the document's `.page` container CSS rule has its own
    // unconditional `overflow:hidden` (unrelated -- it clips the 6in x 4in
    // page canvas, not any one region), so this asserts on the region's
    // own `<div class="region" ...>` markup specifically, not the whole
    // document.
    const content = parsePostcardContent({
      front_image: 'front.png',
      front_regions: [minimalRegion()],
    });
    const html = renderPostcardHtml(content);
    const regionMarkup = html.match(/<div class="region"[^>]*>/)?.[0];
    expect(regionMarkup).toBeDefined();
    expect(regionMarkup).not.toContain('overflow:hidden');
  });

  it('includes extra_html verbatim (AC4, e.g. a QR <img>)', () => {
    const qr = '<div style="position:absolute; top:1in; right:1in;"><img src="qr.png"></div>';
    const content = parsePostcardContent({
      front_image: 'front.png',
      back_image: 'back.png',
      back_extra_html: qr,
    });
    const html = renderPostcardHtml(content);
    expect(html).toContain(qr);
  });

  it('escapes region text as HTML (not raw-injected, unlike extra_html/style)', () => {
    const content: PostcardContent = parsePostcardContent({
      front_image: 'front.png',
      front_regions: [minimalRegion({ text: '<script>alert(1)</script>' })],
    });
    const html = renderPostcardHtml(content);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
