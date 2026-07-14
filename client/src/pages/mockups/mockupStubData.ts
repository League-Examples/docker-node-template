/**
 * Static stub data for the wireframe mockup pages under /mockups/*.
 *
 * These pages are structural wireframes only (spec: "real, simple web
 * pages ... but just mockups"). Nothing here is fetched from the backend —
 * every mockup page renders from this in-memory data so the pages can be
 * reviewed without any server/database work landing first.
 */

export type LibraryCategory = 'assets' | 'examples' | 'styles' | 'projects';

export interface LibraryItem {
  id: string;
  label: string;
  /** One-line stand-in for the description/prompt text an item can carry. */
  detail: string;
}

export const LIBRARY_CATEGORY_LABELS: Record<LibraryCategory, string> = {
  assets: 'Assets',
  examples: 'Examples',
  styles: 'Styles',
  projects: 'Projects',
};

export const LIBRARY_ITEMS: Record<LibraryCategory, LibraryItem[]> = {
  assets: [
    { id: 'asset-1', label: 'League robot logo (primary)', detail: 'logo · svg' },
    { id: 'asset-2', label: 'Robotics team photo — regional 2025', detail: 'photo · prior-art' },
    { id: 'asset-3', label: 'Stock: confetti burst', detail: 'stock image' },
    { id: 'asset-4', label: 'Stock: classroom crowd', detail: 'stock image' },
  ],
  examples: [
    { id: 'example-1', label: 'Pop-art scene — hero pose', detail: 'example image' },
    { id: 'example-2', label: 'Comic panel — action layout', detail: 'example image' },
    { id: 'example-3', label: 'Flat poster — event announcement', detail: 'example image' },
  ],
  styles: [
    { id: 'style-pop-art', label: 'Pop Art', detail: 'Ben-Day dots, flat primary palette' },
    { id: 'style-comic-book', label: 'Comic Book', detail: 'bold ink lines, halftone shading' },
    { id: 'style-manga', label: 'Manga', detail: 'screentone, dynamic panel energy' },
    { id: 'style-flat-poster', label: 'Flat Poster', detail: 'solid shapes, minimal palette' },
  ],
  projects: [
    { id: 'project-1', label: 'Spring Open House Flyer', detail: 'postcard · pop art' },
    { id: 'project-2', label: 'Robotics Regionals Postcard', detail: 'postcard · comic book' },
    { id: 'project-3', label: 'Summer Reading Program Poster', detail: 'flyer · flat poster' },
  ],
};

export interface OutputIteration {
  id: string;
  label: string;
  isCurrent?: boolean;
}

export const STUB_OUTPUT_ITERATIONS: OutputIteration[] = [
  { id: 'iter-001', label: 'Iteration 1' },
  { id: 'iter-002', label: 'Iteration 2' },
  { id: 'iter-003', label: 'Iteration 3', isCurrent: true },
];

export interface ChatMessage {
  id: string;
  from: 'user' | 'assistant';
  text: string;
}

export const STUB_CHAT_MESSAGES: ChatMessage[] = [
  {
    id: 'msg-1',
    from: 'assistant',
    text: "Here's the latest iteration of the Spring Open House flyer. What do you think?",
  },
  {
    id: 'msg-2',
    from: 'user',
    text: 'Make the starburst bigger and try a warmer palette.',
  },
  {
    id: 'msg-3',
    from: 'assistant',
    text: 'Got it — generating iteration 4 with a bigger starburst and a warmer palette now.',
  },
];

/**
 * Postcard text-region stub data, grounded in the shape of a real generated
 * project's `postcard-content.json` (see
 * `marketing/projects/Robot-Riot-Postcard/postcard-content.json`): each
 * region carries a `name` (state key), a human `label`, inline CSS `style`,
 * the current `text`, a `position` in inches, and a `font`. This mockup
 * does not implement chroma-key rendering or a print-accurate layout — the
 * `position` values are used only as a structural approximation.
 */
export type PostcardSide = 'front' | 'back';

export interface PostcardRegionPosition {
  top: string;
  left?: string;
  right?: string;
  width: string;
}

export interface PostcardRegionFont {
  family: string;
  size: string;
}

export interface PostcardRegion {
  name: string;
  label: string;
  style: string;
  text: string;
  position: PostcardRegionPosition;
  font: PostcardRegionFont;
}

export const STUB_POSTCARD_REGIONS: Record<PostcardSide, PostcardRegion[]> = {
  // The real Robot-Riot-Postcard project also has an empty front_regions
  // array — the front side of this particular postcard is image-only.
  front: [],
  back: [
    {
      name: 'back_headline',
      label: 'Headline',
      style: 'font-weight:900; color:#CC1616; letter-spacing:1px;',
      text: 'ROBOT RIOT',
      position: { top: '1.0in', left: '0.5in', width: '3.4in' },
      font: { family: "'Arial Black', Arial, sans-serif", size: '34px' },
    },
    {
      name: 'back_datetime',
      label: 'Date & location',
      style: 'font-weight:700; color:#16223C;',
      text: 'Saturday, July 11 · 1:00 PM · The Robot Garage',
      position: { top: '1.49in', left: '0.5in', width: '3.4in' },
      font: { family: 'Arial, Helvetica, sans-serif', size: '18px' },
    },
    {
      name: 'back_body',
      label: 'Body copy',
      style: 'line-height:1.5; color:#101010;',
      text:
        'You build the robot. You wire it, program it, and rig it with ' +
        "flippers, pushers, and grippers. Then you drive it into the " +
        "arena and crash it into everyone else's machine. No spectating " +
        "— you're in the driver's seat.",
      position: { top: '1.86in', left: '0.5in', width: '3.4in' },
      font: { family: "Georgia, 'Times New Roman', serif", size: '15.5px' },
    },
    {
      name: 'back_cta',
      label: 'Call to action',
      style: 'font-weight:800; color:#C96A10;',
      text: "Scan to sign up — it's free!",
      position: { top: '3.25in', left: '0.5in', width: '3.4in' },
      font: { family: 'Arial, Helvetica, sans-serif', size: '16px' },
    },
    {
      name: 'back_url',
      label: 'QR caption — URL',
      style: 'text-align:center; font-weight:700; color:#16223C;',
      text: 'jointheleague.org/0G',
      position: { top: '2.73in', right: '0.5in', width: '1.5in' },
      font: { family: 'Arial, Helvetica, sans-serif', size: '13px' },
    },
    {
      name: 'back_nonprofit',
      label: 'QR caption — nonprofit/EIN',
      style: 'text-align:center; color:#666; line-height:1.35;',
      text: 'The League of Amazing Programmers is a 501(c)(3) nonprofit, EIN 20-4744610',
      position: { top: '2.95in', right: '0.5in', width: '1.5in' },
      font: { family: 'Arial, Helvetica, sans-serif', size: '10px' },
    },
  ],
};

export interface PostcardExtraOverlay {
  /** Label shown on the placeholder box — this mockup does not render the
   * real extra_html/QR image, just the region it occupies. */
  label: string;
  position: PostcardRegionPosition & { height: string };
}

export const STUB_POSTCARD_EXTRA_OVERLAY: Record<PostcardSide, PostcardExtraOverlay | null> = {
  front: null,
  back: {
    label: 'QR code overlay (extra_html)',
    position: { top: '1.15in', right: '0.5in', width: '1.5in', height: '1.5in' },
  },
};

export const STUB_PROJECT_NAME = 'Spring Open House Flyer';
export const STUB_PROJECT_META = 'Postcard · Pop Art style';

/**
 * Opening exchange for the /mockups/new-project chat panel (spec §7): the
 * assistant asks the same guideline questions the blank project-details
 * header above it carries — style, output type, and goal — before any
 * project details are filled in.
 */
export const STUB_NEW_PROJECT_CHAT_MESSAGES: ChatMessage[] = [
  {
    id: 'new-project-msg-1',
    from: 'assistant',
    text:
      "Let's start your new project. What style are you going for, what " +
      'kind of output do you need — a Facebook image, a logo, or a ' +
      'postcard — and what are you trying to achieve?',
  },
];

/**
 * Stub exchange for the /mockups/postcard-edit chat panel: the chat is not
 * limited to text-region edits — the user can instruct about almost
 * anything on this surface (spec §11; stakeholder, 2026-07-14).
 */
export const STUB_POSTCARD_CHAT_MESSAGES: ChatMessage[] = [
  {
    id: 'postcard-msg-1',
    from: 'user',
    text: 'Move the QR code down a bit and make the headline punchier.',
  },
  {
    id: 'postcard-msg-2',
    from: 'assistant',
    text:
      "Done — QR overlay nudged toward the bottom margin, and I've drafted " +
      'a bolder headline in the Headline field. Anything else — layout, ' +
      'regions, fonts, or a new back-side image?',
  },
];

/**
 * Project cards for the /mockups/projects list — the post-login home
 * concept (stakeholder, 2026-07-14): every project, each showing a HERO
 * image = the most recently accepted iteration (usually the last one);
 * for postcards the hero is the FRONT, never the back.
 */
export interface ProjectCard {
  id: string;
  name: string;
  kind: string;
  /** Which image is the hero and why — wireframe stand-in for the image. */
  hero: string;
  updated: string;
}

export const STUB_PROJECT_CARDS: ProjectCard[] = [
  {
    id: 'proj-open-house',
    name: 'Spring Open House Postcard',
    kind: 'Postcard · Pop Art',
    hero: 'Front — Iteration 2 (accepted)',
    updated: 'today',
  },
  {
    id: 'proj-robot-riot',
    name: 'Robot Riot Postcard',
    kind: 'Postcard · Comic Book',
    hero: 'Front — Iteration 5 (accepted)',
    updated: 'yesterday',
  },
  {
    id: 'proj-summer-poster',
    name: 'Summer Reading Program Poster',
    kind: 'Flyer · Flat Poster',
    hero: 'Iteration 3 (last — nothing accepted)',
    updated: '3 days ago',
  },
  {
    id: 'proj-fb-camp',
    name: 'Coding Camp Facebook Post',
    kind: 'Facebook image · Manga',
    hero: 'Iteration 7 (accepted)',
    updated: 'last week',
  },
];
