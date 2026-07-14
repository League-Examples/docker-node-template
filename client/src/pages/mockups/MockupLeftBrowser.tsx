import { useState } from 'react';
import {
  LIBRARY_CATEGORY_LABELS,
  LIBRARY_ITEMS,
  type LibraryCategory,
} from './mockupStubData';

const CATEGORIES = Object.keys(LIBRARY_CATEGORY_LABELS) as LibraryCategory[];

/**
 * Left pane of the two-pane main layout: a browser for assets, examples,
 * styles, and previous projects (spec §2, §3). Structural wireframe only —
 * the search box and tabs are non-functional stand-ins for the eventual
 * conversational/filter-bar filtering described in spec §3.
 */
export default function MockupLeftBrowser() {
  const [active, setActive] = useState<LibraryCategory>('assets');
  const items = LIBRARY_ITEMS[active];

  return (
    <aside className="w-1/2 flex-shrink-0 border-r border-slate-200 bg-white flex flex-col">
      <div className="p-3 border-b border-slate-200">
        <input
          type="search"
          placeholder="Search library…"
          disabled
          className="w-full rounded border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm text-slate-400"
        />
      </div>

      <nav className="flex border-b border-slate-200" aria-label="Library categories">
        {CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => setActive(category)}
            aria-pressed={active === category}
            className={
              active === category
                ? 'flex-1 px-2 py-2 text-xs font-semibold text-indigo-600 border-b-2 border-indigo-600'
                : 'flex-1 px-2 py-2 text-xs font-medium text-slate-500 border-b-2 border-transparent'
            }
          >
            {LIBRARY_CATEGORY_LABELS[category]}
          </button>
        ))}
      </nav>

      {/* Two-column grid of rectangular asset tiles. */}
      <ul className="grid flex-1 grid-cols-2 content-start gap-2 overflow-y-auto p-2">
        {items.map((item) => (
          <li key={item.id} className="rounded border border-slate-200 p-2">
            <div
              aria-hidden="true"
              className="mb-2 aspect-video w-full rounded bg-slate-200"
            />
            <p className="truncate text-sm text-slate-800">{item.label}</p>
            <p className="truncate text-xs text-slate-400">{item.detail}</p>
          </li>
        ))}
      </ul>
    </aside>
  );
}
