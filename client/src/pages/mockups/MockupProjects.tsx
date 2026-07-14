import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LIBRARY_CATEGORY_LABELS,
  LIBRARY_ITEMS,
  STUB_PROJECT_CARDS,
  type LibraryCategory,
} from './mockupStubData';

type ProjectView = 'mine' | 'all' | 'library' | 'archive';

const VIEW_LABELS: Record<ProjectView, string> = {
  mine: 'My projects',
  all: 'All projects',
  library: 'Library',
  archive: 'Archive',
};

const LIBRARY_CATEGORIES = Object.keys(LIBRARY_CATEGORY_LABELS) as LibraryCategory[];

/**
 * /mockups/projects — the project-list wireframe: the concept for the
 * post-login HOME page (stakeholder, 2026-07-14). Every project appears
 * as a card whose hero image is the most recently ACCEPTED iteration
 * (usually the last one); for postcards the hero is the FRONT of the
 * postcard, never the back. Front/back marking and the accepted flag
 * live on the iterations themselves — see /mockups/main.
 *
 * Views (stakeholder, 2026-07-14): users are logged in with their email
 * addresses, so the list has My projects (ones I created), All projects
 * (everybody's), Library, and Archive (archived projects).
 *
 * Library view (stakeholder, 2026-07-14, round 12): clicking a library
 * asset CREATES A PROJECT for that asset — you manipulate the asset as a
 * project and later put it back into the library (mostly by asking the
 * AI to put things into the library).
 */
export default function MockupProjects() {
  const [view, setView] = useState<ProjectView>('mine');

  const visible = STUB_PROJECT_CARDS.filter((p) => {
    if (view === 'library') return false; // library shows assets, not projects
    if (view === 'archive') return p.archived;
    if (view === 'mine') return p.mine && !p.archived;
    return !p.archived;
  });

  return (
    <div className="min-h-screen bg-slate-50 p-8 text-slate-800">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-800">Projects</h1>
            <p className="text-sm text-slate-500">
              Hero image = most recently accepted iteration; postcards show
              their front.
            </p>
          </div>
          <button
            type="button"
            disabled
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            New project
          </button>
        </div>

        <div
          role="group"
          aria-label="Project views"
          className="mb-4 inline-flex overflow-hidden rounded border border-slate-300"
        >
          {(Object.keys(VIEW_LABELS) as ProjectView[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={
                view === option
                  ? 'bg-indigo-600 px-4 py-2 text-sm font-semibold text-white'
                  : 'bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50'
              }
            >
              {VIEW_LABELS[option]}
            </button>
          ))}
        </div>

        {view === 'library' && (
          <div>
            <p className="mb-3 text-sm text-slate-500">
              Click an asset to create a project for it — manipulate it as a
              project, then put it back into the library (usually by asking
              the AI).
            </p>
            {LIBRARY_CATEGORIES.map((category) => (
              <section key={category} className="mb-5">
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {LIBRARY_CATEGORY_LABELS[category]}
                </h2>
                <ul className="grid grid-cols-3 gap-3">
                  {LIBRARY_ITEMS[category].map((item) => (
                    <li key={item.id}>
                      <Link
                        to="/mockups/main"
                        aria-label={`Create a project for ${item.label}`}
                        className="block rounded-lg border border-slate-200 bg-white p-2 hover:border-indigo-400"
                      >
                        {item.image ? (
                          <img
                            src={item.image}
                            alt=""
                            className="mb-1.5 aspect-video w-full rounded bg-slate-100 object-cover"
                          />
                        ) : (
                          <div
                            aria-hidden="true"
                            className="mb-1.5 aspect-video w-full rounded bg-slate-200"
                          />
                        )}
                        <p className="truncate text-sm text-slate-800">{item.label}</p>
                        <p className="truncate text-xs text-slate-400">{item.detail}</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        <ul className="grid grid-cols-2 gap-4">
          {visible.map((project) => (
            <li key={project.id}>
              <Link
                to="/mockups/main"
                className="block rounded-lg border border-slate-200 bg-white p-3 hover:border-indigo-400"
              >
                {project.image ? (
                  <img
                    src={project.image}
                    alt=""
                    className="mb-1 aspect-[3/2] w-full rounded object-cover"
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    className="mb-1 flex aspect-[3/2] w-full items-center justify-center rounded bg-slate-200 text-xs text-slate-500"
                  />
                )}
                <p className="mb-2 text-[11px] text-slate-400">{project.hero}</p>
                <p className="font-semibold text-slate-800">{project.name}</p>
                <p className="text-sm text-slate-500">
                  {project.kind} · updated {project.updated}
                </p>
                <p className="text-xs text-slate-400">{project.owner}</p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
