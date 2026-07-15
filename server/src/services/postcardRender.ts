import { z } from 'zod';
import { prisma as defaultPrisma } from './prisma';

/**
 * Postcard Render & PDF Service, first half (architecture-update.md Step
 * 3, addendum eleventh module; ticket 005). Turns an agent/admin-supplied
 * "content JSON" describing a postcard's front/back faces into a
 * self-contained `postcard.html` render -- content-JSON validation and
 * HTML templating only; PDF export is out of this ticket's scope (ticket
 * 006).
 *
 * **Content-JSON shape** mirrors the predecessor system's
 * `postcard-content.json` exactly (verified against
 * `marketing/projects/Robot-Riot-Postcard/postcard-content.json`, the
 * ground-truth source of this shape):
 *
 * ```
 * {
 *   "front_image": "projects/5/iterations/iter-2.png",   // workspace-relative Iteration.imagePath
 *   "back_image": "projects/5/iterations/iter-4.png",    // optional -- its presence is what makes this a two-sided postcard (see R3 below)
 *   "front_regions": [ ... ],
 *   "back_regions": [
 *     {
 *       "name": "back_headline",           // stable identifier, used as the rendered div's data-region attribute
 *       "label": "Headline",                // human-readable label (editor UI concern; not used by this ticket's render)
 *       "style": "font-weight:900; color:#CC1616;",  // raw CSS declarations, appended verbatim to the region div's style attribute
 *       "text": "ROBOT RIOT",                // rendered as one <p> per blank-line-separated paragraph, single newlines within a paragraph become <br />
 *       "rows": null,                        // editor-textarea sizing hint (editor UI concern; not used by this ticket's render)
 *       "position": { "top": "1.0in", "left": "0.5in", "width": "3.4in" }, // inches -> CSS `in` units, 1:1, no conversion; "left" or "right" (not both), "height" optional (see below)
 *       "font": { "family": "'Arial Black', Arial, sans-serif", "size": "34px" }
 *     }
 *   ],
 *   "front_extra_html": "",
 *   "back_extra_html": "<div style=\"position:absolute; ...\"><img src=\"...\"></div>" // QR overlays and anything else that doesn't fit the region model; injected verbatim
 * }
 * ```
 *
 * **`position.height` (wireframe interaction contract, stakeholder rounds
 * 4/7/8/10)**: optional. When present, the rendered region is given that
 * exact CSS height and `overflow:hidden` so overflowing text is clipped
 * rather than pushing layout around -- the wireframe's "regions have exact
 * drawn sizes" contract. Omitted (the common case, matching the
 * predecessor's own regions) means the region's height is whatever its
 * content naturally takes.
 *
 * **R3 (architecture-update.md)**: which image is "front"/"back", and
 * whether the postcard is front-only or front+back, is read directly off
 * `front_image`/`back_image`'s presence in the content JSON -- no separate
 * "accepted" flag or `Iteration` column. A content JSON with only
 * `front_image` renders only the front face; both keys present renders
 * both. This module never itself decides "current" state -- the route
 * layer's use of `create_agent_page` (which overwrites
 * `postcard-content.json`/`postcard.html` in place on every call) is what
 * makes the persisted file naturally represent "current".
 */

// ---------------------------------------------------------------------------
// Content-JSON shape
// ---------------------------------------------------------------------------

const PostcardRegionPositionSchema = z
  .object({
    top: z.string(),
    left: z.string().optional(),
    right: z.string().optional(),
    width: z.string(),
    height: z.string().optional(),
  })
  .refine((pos) => pos.left !== undefined || pos.right !== undefined, {
    message: 'position must include a left or right offset',
  });

const PostcardRegionFontSchema = z.object({
  family: z.string(),
  size: z.string(),
});

const PostcardRegionSchema = z.object({
  name: z.string(),
  label: z.string(),
  style: z.string(),
  text: z.string(),
  rows: z.number().int().nullable().optional(),
  position: PostcardRegionPositionSchema,
  font: PostcardRegionFontSchema,
});

const PostcardContentSchema = z
  .object({
    front_image: z.string().optional(),
    back_image: z.string().optional(),
    front_regions: z.array(PostcardRegionSchema).optional().default([]),
    back_regions: z.array(PostcardRegionSchema).optional().default([]),
    front_extra_html: z.string().optional().default(''),
    back_extra_html: z.string().optional().default(''),
  })
  .refine((content) => content.front_image !== undefined || content.back_image !== undefined, {
    message: 'at least one of front_image or back_image is required',
  });

export type PostcardRegionPosition = z.infer<typeof PostcardRegionPositionSchema>;
export type PostcardRegionFont = z.infer<typeof PostcardRegionFontSchema>;
export type PostcardRegion = z.infer<typeof PostcardRegionSchema>;
export type PostcardContent = z.infer<typeof PostcardContentSchema>;

/** Thrown for any content-JSON problem this module can detect on its own
 * (shape validation, or a `front_image`/`back_image` that doesn't match
 * any `Iteration` for the project) -- distinguishable from an unexpected
 * error so route layers can map it to a 400 rather than a 500. */
export class PostcardValidationError extends Error {}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Validates `raw` against the content-JSON shape above. Throws
 * `PostcardValidationError` with a human-readable message (Zod's issue
 * list, joined) on any shape violation -- never lets a malformed body
 * reach the HTML template. */
export function parsePostcardContent(raw: unknown): PostcardContent {
  const result = PostcardContentSchema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new PostcardValidationError(`Invalid postcard content JSON: ${message}`);
  }
  return result.data;
}

/** Confirms that a validated content JSON's `front_image`/`back_image`
 * (whichever are present) each match an existing `Iteration.imagePath` for
 * `projectId` -- so a broken/typo'd image reference is caught here, before
 * any file is written, rather than silently rendering a dead `<img>` (this
 * ticket's AC6). Throws `PostcardValidationError` naming the offending
 * field and value on a mismatch. */
export async function resolvePostcardImages(
  content: PostcardContent,
  projectId: number,
  prismaClient: any = defaultPrisma
): Promise<void> {
  const checks: Array<['front_image' | 'back_image', string | undefined]> = [
    ['front_image', content.front_image],
    ['back_image', content.back_image],
  ];

  for (const [field, imagePath] of checks) {
    if (imagePath === undefined) continue;
    const iteration = await prismaClient.iteration.findFirst({
      where: { projectId, imagePath },
    });
    if (!iteration) {
      throw new PostcardValidationError(
        `${field} "${imagePath}" does not match any Iteration.imagePath for project ${projectId}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Renders `text` as one `<p>` per blank-line-separated paragraph, with
 * single newlines inside a paragraph becoming `<br />` -- matches the
 * predecessor's `postcard.html` rendering exactly (verified against e.g.
 * `back_headline`'s `"ROBOT RIOT\n\n"` -> `<p>ROBOT RIOT</p>` and
 * `back_nonprofit`'s two-line text -> a single `<p>` with an internal
 * `<br />`). Trailing blank lines are trimmed first so a trailing `\n\n`
 * (as in the `back_headline` example) doesn't produce an empty trailing
 * paragraph. */
function textToParagraphsHtml(text: string): string {
  const trimmed = text.replace(/\s+$/, '');
  const paragraphs = trimmed.split(/\n\n+/).filter((p) => p.length > 0);
  return paragraphs
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br />\n')}</p>`)
    .join('\n');
}

/** Builds the inline `style` attribute value for one region's `<div>`:
 * absolute position (inches -> CSS `in` units, 1:1) + font + the region's
 * own raw `style` CSS, in that order. `position.height`, when present,
 * also adds `overflow:hidden` (see module header on the wireframe's
 * exact-drawn-size / clipped-overflow contract). */
function regionStyleAttr(region: PostcardRegion): string {
  const parts: string[] = ['position:absolute', `top:${region.position.top}`];
  if (region.position.left !== undefined) parts.push(`left:${region.position.left}`);
  if (region.position.right !== undefined) parts.push(`right:${region.position.right}`);
  parts.push(`width:${region.position.width}`);
  if (region.position.height !== undefined) {
    parts.push(`height:${region.position.height}`);
    parts.push('overflow:hidden');
  }
  parts.push(`font-family:${region.font.family}`);
  parts.push(`font-size:${region.font.size}`);
  const trimmedStyle = region.style.trim();
  if (trimmedStyle.length > 0) parts.push(trimmedStyle.replace(/;\s*$/, ''));
  return `${parts.join('; ')};`;
}

function renderRegion(region: PostcardRegion): string {
  return `<div class="region" data-region="${escapeHtml(region.name)}" style="${escapeHtml(regionStyleAttr(region))}">${textToParagraphsHtml(region.text)}</div>`;
}

/** Renders one face ("front" or "back") -- background image, then
 * `extraHtml` verbatim (QR overlays etc.), then one `<div>` per region.
 * Returns `''` (renders nothing) when `image` is `undefined` -- this is
 * what makes a front-only content JSON produce a front-only render (this
 * ticket's AC1/AC2, R3). */
function renderFace(
  side: 'front' | 'back',
  image: string | undefined,
  regions: PostcardRegion[],
  extraHtml: string
): string {
  if (image === undefined) return '';

  const regionsHtml = regions.map(renderRegion).join('\n');
  const label = side.toUpperCase();

  return `
  <div class="page-block">
    <div class="pagelabel">${label}</div>
    <section class="page" data-side="${side}">
      <img class="bg" src="${escapeHtml(image)}" alt="${label}">
      ${extraHtml}
      ${regionsHtml}
    </section>
  </div>`;
}

/** Renders a validated content JSON to a self-contained `postcard.html`
 * string: the background image(s) plus one absolutely-positioned `<div>`
 * per region (inches -> CSS `in` units, 1:1) plus each face's
 * `extra_html`, matching the predecessor's `postcard.html` render model.
 * No client-side JS -- this ticket's scope is server-side templating only
 * (Sprint 005 wires up any interactive editing). */
export function renderPostcardHtml(content: PostcardContent): string {
  const frontHtml = renderFace('front', content.front_image, content.front_regions, content.front_extra_html);
  const backHtml = renderFace('back', content.back_image, content.back_regions, content.back_extra_html);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Postcard Preview</title>
<style>
 *{box-sizing:border-box;}
 body{margin:0;background:#101317;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;}
 .wrap{max-width:900px;margin:0 auto;padding:24px;display:flex;flex-direction:column;gap:36px;align-items:center;}
 .page-block{display:flex;flex-direction:column;align-items:center;gap:10px;}
 .page{width:6in;height:4in;position:relative;overflow:hidden;box-sizing:border-box;background:#fff;box-shadow:0 8px 30px rgba(0,0,0,.5);border:1px solid #333;}
 .page img.bg{width:100%;height:100%;object-fit:cover;display:block;}
 .region{position:absolute;}
 .region p{margin:0 0 0.6em;}
 .region p:last-child{margin-bottom:0;}
 .pagelabel{color:#889;font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:700;align-self:flex-start;margin-left:2px;}
</style>
</head>
<body>
<div class="wrap">${frontHtml}${backHtml}
</div>
</body>
</html>`;
}
