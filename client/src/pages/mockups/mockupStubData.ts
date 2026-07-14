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
