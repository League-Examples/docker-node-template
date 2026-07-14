import { useState } from 'react';
import MockupLeftBrowser from './MockupLeftBrowser';
import MockupOutputPane from './MockupOutputPane';
import MockupChatPanel from './MockupChatPanel';
import type { LibraryItem } from './mockupStubData';

/**
 * /mockups/main — the main layout wireframe (spec §2).
 *
 * Layout decisions (stakeholder, 2026-07-14, wireframe review round 5):
 * - The template's sidebar menu moves to a TOP menu / hamburger — a slim
 *   top bar with a hamburger stub stands in for it here.
 * - The asset browser is COLLAPSIBLE and collapsed by default: you only
 *   use it every now and then. A vertical pull-out tab on the left edge
 *   slides it over ~7/8 of the iterations list and chat window (it may
 *   obscure the screen).
 * - Double-clicking an item adds it to the project as a reference and
 *   closes the browser automatically. Added references show as chips.
 * This page deliberately renders outside AppLayout (see
 * architecture-update.md, Decision 4).
 */
export default function MockupMain() {
  const [browserOpen, setBrowserOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [references, setReferences] = useState<LibraryItem[]>([]);

  function handleItemAdd(item: LibraryItem) {
    setReferences((prev) =>
      prev.some((r) => r.id === item.id) ? prev : [...prev, item],
    );
    setBrowserOpen(false);
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-800">
      {/* Top bar: hamburger menu (replaces the old sidebar menu) + Library toggle. */}
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <div className="relative">
          <button
            type="button"
            aria-label="Menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            ☰
          </button>
          {menuOpen && (
            <nav
              aria-label="App menu"
              className="absolute left-0 top-full z-40 mt-1 w-44 rounded border border-slate-200 bg-white py-1 shadow-lg"
            >
              {['Home', 'Account', 'About', 'Log out'].map((label) => (
                <span
                  key={label}
                  className="block cursor-default px-4 py-1.5 text-sm text-slate-500"
                >
                  {label}
                </span>
              ))}
            </nav>
          )}
        </div>
        <span className="font-semibold text-slate-700">Flyerbot</span>
      </header>

      {/* Main content: outputs over chat. The browser overlays this. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {references.length > 0 && (
          <div
            data-testid="project-references"
            className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2"
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              References
            </span>
            {references.map((item) => (
              <span
                key={item.id}
                className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-0.5 text-xs text-indigo-700"
              >
                {item.label}
              </span>
            ))}
          </div>
        )}

        <MockupOutputPane />
        <MockupChatPanel />

        {/* Collapsible asset browser: a sliding drawer with a vertical
            pull-out tab on the left edge; overlays ~7/8 of outputs + chat. */}
        <div
          data-testid="library-overlay"
          data-open={browserOpen}
          className={`absolute inset-y-0 left-0 z-30 flex w-[87.5%] flex-col border-r border-slate-300 bg-white shadow-2xl transition-transform duration-300 ${
            browserOpen ? 'translate-x-0' : 'pointer-events-none -translate-x-full'
          }`}
        >
          <div aria-hidden={!browserOpen} className="flex min-h-0 flex-1 flex-col">
            <MockupLeftBrowser
              onClose={() => setBrowserOpen(false)}
              onItemAdd={handleItemAdd}
            />
          </div>
          {/* The pull tab rides on the drawer's right edge, so it is the
              visible handle when closed and the close control when open. */}
          <button
            type="button"
            aria-label={browserOpen ? 'Close library' : 'Open library'}
            aria-expanded={browserOpen}
            onClick={() => setBrowserOpen((v) => !v)}
            style={{ writingMode: 'vertical-rl' }}
            className="pointer-events-auto absolute -right-8 top-1/4 rounded-r-lg bg-indigo-600 px-1.5 py-4 text-sm font-semibold tracking-wide text-white shadow-lg hover:bg-indigo-700"
          >
            {browserOpen ? '◂ Close' : 'Library ▸'}
          </button>
        </div>
      </div>
    </div>
  );
}
