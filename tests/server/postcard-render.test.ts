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
import { renderQrGraphicHtml, CAPTION_VIEWBOX_WIDTH } from '../../server/src/services/qrCode';

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

  it('front_qr/back_qr default to undefined -- absent means no QR on that face', () => {
    const content = parsePostcardContent({ front_image: 'x' });
    expect(content.front_qr).toBeUndefined();
    expect(content.back_qr).toBeUndefined();
  });

  it('accepts a structured front_qr/back_qr object', () => {
    const content = parsePostcardContent({
      front_image: 'front.png',
      back_image: 'back.png',
      front_qr: { url: 'https://example.org/front', position: { top: '1.15in', right: '0.5in', width: '1.5in', height: '1.5in' } },
      back_qr: { url: 'https://example.org/back', position: { top: '2in', left: '0.5in', width: '1.5in' } },
    });
    expect(content.front_qr).toEqual({
      url: 'https://example.org/front',
      position: { top: '1.15in', right: '0.5in', width: '1.5in', height: '1.5in' },
    });
    expect(content.back_qr?.url).toBe('https://example.org/back');
  });

  it('rejects a QR position with neither left nor right, same as a region position', () => {
    expect(() =>
      parsePostcardContent({
        front_image: 'x',
        front_qr: { url: 'https://example.org', position: { top: '1in', width: '1.5in' } },
      })
    ).toThrow(PostcardValidationError);
  });

  it('rejects a QR object missing a required field', () => {
    expect(() =>
      parsePostcardContent({
        front_image: 'x',
        front_qr: { position: { top: '1in', left: '1in', width: '1.5in' } },
      })
    ).toThrow(PostcardValidationError);
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

  describe('front_qr/back_qr overlay (OOP: optional, structured, positioned QR)', () => {
    it('renders nothing for a face with no QR data -- AC1, including pre-existing content with no front_qr/back_qr at all', () => {
      const content = parsePostcardContent({ front_image: 'front.png', back_image: 'back.png' });
      const html = renderPostcardHtml(content);
      expect(html).not.toContain('data-qr-url');
      expect(html).not.toContain('QR code');
    });

    it('renders a face\'s QR overlay at its own position when present', () => {
      const content = parsePostcardContent({
        front_image: 'front.png',
        front_qr: {
          url: 'https://example.org/signup',
          position: { top: '2.00in', left: '0.75in', width: '1.20in', height: '1.20in' },
        },
      });
      const html = renderPostcardHtml(content);
      expect(html).toContain('data-qr-url="https://example.org/signup"');
      expect(html).toContain('top:2.00in');
      expect(html).toContain('left:0.75in');
      expect(html).toContain('width:1.20in');
      expect(html).toContain('height:1.20in');
    });

    it('renders front_qr and back_qr independently -- one face can have a QR while the other does not', () => {
      const content = parsePostcardContent({
        front_image: 'front.png',
        back_image: 'back.png',
        back_qr: { url: 'https://example.org/back-only', position: { top: '1in', right: '0.5in', width: '1.5in' } },
      });
      const html = renderPostcardHtml(content);
      const frontSection = html.split('data-side="front"')[1].split('data-side="back"')[0];
      const backSection = html.split('data-side="back"')[1];
      expect(frontSection).not.toContain('data-qr-url');
      expect(backSection).toContain('data-qr-url="https://example.org/back-only"');
    });

    it('escapes the QR url as an HTML attribute/text value', () => {
      const content = parsePostcardContent({
        front_image: 'front.png',
        front_qr: {
          url: 'https://example.org/?a=1&b="x"',
          position: { top: '1in', left: '1in', width: '1.5in' },
        },
      });
      const html = renderPostcardHtml(content);
      expect(html).not.toContain('href="https://example.org/?a=1&b="x""');
      expect(html).toContain('&amp;b=&quot;x&quot;');
    });

    describe('real QR graphic + width-matched URL caption (OOP, 2026-07-15)', () => {
      it('embeds a real <svg><path> tracing the URL\'s own encoded module grid, not a placeholder', () => {
        const content = parsePostcardContent({
          front_image: 'front.png',
          front_qr: {
            url: 'https://example.org/signup',
            position: { top: '1.15in', right: '0.5in', width: '1.5in', height: '1.5in' },
          },
        });
        const html = renderPostcardHtml(content);
        expect(html).not.toContain('QR code<br');
        expect(html).toContain('<svg');
        // Same expected markup `renderQrGraphicHtml` itself produces --
        // asserted against the real function, not a hand-copied fixture,
        // so this fails if the encoding ever silently changes.
        expect(html).toContain(renderQrGraphicHtml('https://example.org/signup'));
      });

      it('renders nothing graphic-wise (still a bare positioned div) when the QR has a blank URL', () => {
        const content = parsePostcardContent({
          front_image: 'front.png',
          front_qr: { url: '', position: { top: '1in', left: '1in', width: '1.5in' } },
        });
        const html = renderPostcardHtml(content);
        expect(html).toContain('data-qr-url=""');
        expect(html).not.toContain('<svg');
      });

      it('renders a different module-grid path for a different URL -- a real encoding, not a static image', () => {
        const shortContent = parsePostcardContent({
          front_image: 'front.png',
          front_qr: { url: 'https://x.co/a', position: { top: '1in', left: '1in', width: '1.5in' } },
        });
        const longContent = parsePostcardContent({
          front_image: 'front.png',
          front_qr: {
            url: 'https://example.org/a-very-long-path-segment/with/many/nested/parts?and=query&params=too',
            position: { top: '1in', left: '1in', width: '1.5in' },
          },
        });
        const shortHtml = renderPostcardHtml(shortContent);
        const longHtml = renderPostcardHtml(longContent);
        const shortPath = shortHtml.match(/<path d="([^"]*)"/)?.[1];
        const longPath = longHtml.match(/<path d="([^"]*)"/)?.[1];
        expect(shortPath).toBeTruthy();
        expect(longPath).toBeTruthy();
        expect(shortPath).not.toBe(longPath);
      });

      it.each([
        ['a short URL', 'https://x.co/a'],
        ['a long URL', 'https://example.org/a-very-long-path-segment/with/many/nested/parts?and=query&params=too'],
      ])('width-matches the URL caption to the QR graphic for %s via textLength/lengthAdjust', (_label, url) => {
        const content = parsePostcardContent({
          front_image: 'front.png',
          front_qr: { url, position: { top: '1in', left: '1in', width: '1.5in' } },
        });
        const html = renderPostcardHtml(content);
        // Both the QR graphic's wrapper and the caption's wrapper are
        // `width:100%` of the SAME flex-column parent -- this is what
        // makes the caption's rendered width equal the QR's rendered
        // width for ANY url length, without either side computing a pixel
        // value. The caption <text> itself is stretched/compressed via
        // `textLength` to its own SVG's full viewBox width.
        expect(html).toContain(`textLength="${CAPTION_VIEWBOX_WIDTH}"`);
        expect(html).toContain('lengthAdjust="spacingAndGlyphs"');
        // The caption text is HTML-escaped (attribute-adjacent text
        // node), so a URL with `&` shows up entity-escaped here too.
        const escapedUrl = url.replace(/&/g, '&amp;');
        expect(html).toContain(`>${escapedUrl}</text>`);
      });
    });
  });
});
