import { useState } from 'react';
import {
  LIBRARY_CATEGORY_LABELS,
  LIBRARY_ITEMS,
  type LibraryCategory,
  type LibraryItem,
} from './mockupStubData';

const CATEGORIES = Object.keys(LIBRARY_CATEGORY_LABELS) as LibraryCategory[];

interface MockupLeftBrowserProps {
  /** Collapse the browser (stakeholder round 5: it's an occasional-use
   * overlay, not a permanent pane). */
  onClose?: () => void;
  /** Double-click adds the item to the project and closes the browser. */
  onItemAdd?: (item: LibraryItem) => void;
}

/**
 * The asset browser: assets, examples, styles, and previous projects
 * (spec §2, §3). Rendered as a collapsible overlay by MockupMain.
 * Structural wireframe only — the search box and tabs are
 * non-functional stand-ins for the eventual conversational/filter-bar
 * filtering described in spec §3.
 */
export default function MockupLeftBrowser({ onClose, onItemAdd }: MockupLeftBrowserProps) {
  const [active, setActive] = useState<LibraryCategory>('assets');
  const items = LIBRARY_ITEMS[active];

  return (
    <aside className="flex min-h-0 flex-1 flex-col bg-white">
      <div className="flex items-center gap-2 border-b border-slate-200 p-3">
        <input
          type="search"
          placeholder="Search library…"
          disabled
          className="w-full rounded border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm text-slate-400"
        />
        <p className="hidden flex-shrink-0 text-xs text-slate-400 sm:block">
          double-click adds &amp; closes
        </p>
        {onClose && (
          <button
            type="button"
            aria-label="Collapse library"
            onClick={onClose}
            className="flex-shrink-0 rounded border border-slate-300 px-2 py-1 text-sm text-slate-500 hover:bg-slate-50"
          >
            ×
          </button>
        )}
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

      {/* Grid of rectangular asset tiles; double-click adds to project. */}
      <ul className="grid flex-1 grid-cols-2 content-start gap-2 overflow-y-auto p-2 lg:grid-cols-4">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onDoubleClick={() => onItemAdd?.(item)}
              className="w-full rounded border border-slate-200 p-2 text-left hover:border-indigo-400"
            >
              {item.image ? (
                <img
                  src={item.image}
                  alt=""
                  className="mb-2 aspect-video w-full rounded bg-slate-100 object-cover"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="mb-2 aspect-video w-full rounded bg-slate-200"
                />
              )}
              <p className="truncate text-sm text-slate-800">{item.label}</p>
              <p className="truncate text-xs text-slate-400">{item.detail}</p>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
