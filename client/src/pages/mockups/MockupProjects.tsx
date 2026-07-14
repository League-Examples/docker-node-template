import { useState } from 'react';
import { Link } from 'react-router-dom';
import { STUB_PROJECT_CARDS } from './mockupStubData';

type ProjectView = 'mine' | 'all' | 'archive';

const VIEW_LABELS: Record<ProjectView, string> = {
  mine: 'My projects',
  all: 'All projects',
  archive: 'Archive',
};

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
 * (everybody's), and Archive (archived projects).
 */
export default function MockupProjects() {
  const [view, setView] = useState<ProjectView>('mine');

  const visible = STUB_PROJECT_CARDS.filter((p) => {
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
